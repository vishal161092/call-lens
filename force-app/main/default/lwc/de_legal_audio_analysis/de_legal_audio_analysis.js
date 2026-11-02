import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import saveAudioToRecord from '@salesforce/apex/de_LegalAudioService.saveAudioToRecord';
import transcribeAudioFile from '@salesforce/apex/de_LegalAudioService.transcribeAudioFile';
import generateInsights from '@salesforce/apex/de_LegalAudioService.generateInsights';
import createActionRecord from '@salesforce/apex/de_LegalAudioService.createActionRecord';

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result;
            if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
                reject(new Error('Could not read file as base64.'));
                return;
            }
            resolve(dataUrl.split(',')[1]);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

const CATEGORY_ICONS = {
    'matter_intake': 'utility:new',
    'party_extraction': 'utility:people',
    'conflict_reassessment': 'utility:shield',
    'obligation_deadlines': 'utility:clock',
    'missing_information': 'utility:help',
    'risk_governance': 'utility:warning'
};

const CATEGORY_LABELS = {
    'matter_intake': 'Matter Intake',
    'party_extraction': 'Party / Entity Extraction',
    'conflict_reassessment': 'Conflict Reassessment',
    'obligation_deadlines': 'Obligations & Deadlines',
    'missing_information': 'Missing Information',
    'risk_governance': 'Risk & Governance'
};

const CATEGORY_BTN_LABELS = {
    'matter_intake': 'Create Record',
    'party_extraction': 'Create Record',
    'conflict_reassessment': 'Create Task',
    'obligation_deadlines': 'Create Actions',
    'missing_information': 'Create Tracker',
    'risk_governance': 'Create Record'
};

const PROGRESS_STEPS = [
    { id: 'upload', label: 'Upload' },
    { id: 'transcribe', label: 'Transcribe' },
    { id: 'analyse', label: 'Analyse' },
    { id: 'done', label: 'Done' }
];

export default class De_legal_audio_analysis extends LightningElement {
    @api recordId;

    @track nativeTranscript = '';
    @track insightSummary = '';
    @track insightKeyPoints = [];
    @track insightRiskFlags = [];
    @track insightSentiment = '';
    @track toneAnalysis = '';
    @track sentimentDescription = '';
    @track overallScore = '';
    @track improvements = [];
    @track actionCategories = [];

    uploadedFileName = '';
    uploadedFileSize = '';
    isAnalysing = false;
    isInsightLoading = false;
    analysingStatus = '';
    errorMessage = '';
    contentDocumentId = '';
    activeTab = 'insights';
    currentProgressStep = 0;
    isTranscriptExpanded = true;
    pipelineComplete = false;

    _uploadedFile = null;
    _audioBlobUrl = null;
    _audioElement = null;
    _isPlaying = false;
    _currentTimePercentage = 0;
    _currentTime = 0;
    _totalTime = 0;
    _expandedCategories = {};
    _playbackSpeed = 1.0;
    _volume = 100;

    get hasUploadedFile() { return this._uploadedFile !== null; }
    get hasNativeTranscript() { return this.nativeTranscript && this.nativeTranscript.trim().length > 0; }
    get hasAnalysisResults() { return this.insightSummary || this.insightKeyPoints.length > 0 || this.actionCategories.length > 0; }
    get hasKeyPoints() { return this.insightKeyPoints.length > 0; }
    get hasRiskFlags() { return this.insightRiskFlags.length > 0; }
    get hasImprovements() { return this.improvements.length > 0; }
    get hasActionCategories() { return this.actionCategories.length > 0; }
    get hasError() { return this.errorMessage !== ''; }

    get playPauseIcon() { return this._isPlaying ? 'utility:pause' : 'utility:play'; }
    get playPauseAltText() { return this._isPlaying ? 'Pause' : 'Play'; }
    get currentTimeFormatted() { return formatTime(this._currentTime); }
    get totalTimeFormatted() { return formatTime(this._totalTime); }

    get playbackSpeedLabel() { return this._playbackSpeed + 'x'; }
    get volumeLevel() { return this._volume; }

    get waveformProgressStyle() {
        return `width: ${this._currentTimePercentage}%`;
    }

    get isInsightsTab() { return this.activeTab === 'insights'; }
    get isActionsTab() { return this.activeTab === 'actions'; }

    get insightsTabClass() { return 'tab-btn' + (this.activeTab === 'insights' ? ' active' : ''); }
    get actionsTabClass() { return 'tab-btn' + (this.activeTab === 'actions' ? ' active' : ''); }

    get topRowClass() {
        return this.hasUploadedFile ? 'top-row top-row-split' : 'top-row';
    }

    get showPipeline() {
        return this.isAnalysing || this.pipelineComplete;
    }

    get transcriptChevronIcon() { return this.isTranscriptExpanded ? 'utility:chevrondown' : 'utility:chevronright'; }

    get transcriptWordCount() {
        if (!this.nativeTranscript) return '0';
        return this.nativeTranscript.trim().split(/\s+/).length.toString();
    }

    get actionCount() {
        return this.actionCategories.length || '';
    }

    // Score donut
    get scoreDisplay() {
        if (!this.overallScore) return '-';
        const match = this.overallScore.match(/([\d.]+)/);
        return match ? match[1] : this.overallScore;
    }

    get scoreDonutDash() {
        const val = parseFloat(this.scoreDisplay) || 0;
        const pct = (val / 5) * 100;
        return `${pct}, 100`;
    }

    get donutStrokeClass() {
        const val = parseFloat(this.scoreDisplay) || 0;
        if (val >= 4) return 'donut-stroke-green';
        if (val >= 3) return 'donut-stroke-amber';
        return 'donut-stroke-red';
    }

    // Sentiment
    get sentimentType() {
        const s = (this.insightSentiment || '').toLowerCase();
        if (s.includes('positive')) return 'positive';
        if (s.includes('negative')) return 'negative';
        return 'neutral';
    }

    get sentimentIconName() {
        if (this.sentimentType === 'positive') return 'utility:like';
        if (this.sentimentType === 'negative') return 'utility:dislike';
        return 'utility:minus';
    }

    get sentimentIconWrapClass() {
        return `sentiment-icon-wrap sentiment-icon-${this.sentimentType}`;
    }

    get sentimentValueClass() {
        return `sentiment-value-${this.sentimentType}`;
    }

    // Tone chart
    get hasToneChart() {
        return this.toneAnalysis && this.toneAnalysis.length > 0;
    }

    get toneChartBars() {
        const tone = (this.toneAnalysis || '').toLowerCase();
        let urgency = 40, formality = 60, collaboration = 50;

        if (tone.includes('urgent') || tone.includes('action')) urgency = 85;
        else if (tone.includes('cautious')) urgency = 55;
        else urgency = 30;

        if (tone.includes('professional') || tone.includes('formal')) formality = 90;
        else if (tone.includes('informal')) formality = 35;
        else formality = 65;

        if (tone.includes('collaborat') || tone.includes('constructive')) collaboration = 85;
        else if (tone.includes('adversarial') || tone.includes('confrontation')) collaboration = 25;
        else collaboration = 55;

        return [
            { id: 'urgency', label: 'Urgency', value: urgency, valueLabel: urgency + '%', dotClass: 'radar-legend-dot-brand' },
            { id: 'formality', label: 'Formality', value: formality, valueLabel: formality + '%', dotClass: 'radar-legend-dot-green' },
            { id: 'collaboration', label: 'Collaboration', value: collaboration, valueLabel: collaboration + '%', dotClass: 'radar-legend-dot-amber' }
        ];
    }

    // Radar chart geometry (3-axis equilateral)
    _radarPoint(axisIndex, value) {
        const cx = 100, cy = 100, maxR = 75;
        const angles = [-90, 150, 30]; // top, bottom-left, bottom-right in degrees
        const angleDeg = angles[axisIndex];
        const angleRad = (angleDeg * Math.PI) / 180;
        const r = (value / 100) * maxR;
        return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
    }

    _radarGridPoints(pct) {
        const pts = [0, 1, 2].map(i => this._radarPoint(i, pct));
        return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    }

    get radarGrid100() { return this._radarGridPoints(100); }
    get radarGrid75() { return this._radarGridPoints(75); }
    get radarGrid50() { return this._radarGridPoints(50); }
    get radarGrid25() { return this._radarGridPoints(25); }

    get radarDataPoints() {
        const bars = this.toneChartBars;
        const pts = bars.map((b, i) => this._radarPoint(i, b.value));
        return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    }

    get radarDot1X() { return this._radarPoint(0, this.toneChartBars[0].value).x.toFixed(1); }
    get radarDot1Y() { return this._radarPoint(0, this.toneChartBars[0].value).y.toFixed(1); }
    get radarDot2X() { return this._radarPoint(1, this.toneChartBars[1].value).x.toFixed(1); }
    get radarDot2Y() { return this._radarPoint(1, this.toneChartBars[1].value).y.toFixed(1); }
    get radarDot3X() { return this._radarPoint(2, this.toneChartBars[2].value).x.toFixed(1); }
    get radarDot3Y() { return this._radarPoint(2, this.toneChartBars[2].value).y.toFixed(1); }

    // Progress steps
    get progressSteps() {
        return PROGRESS_STEPS.map((step, idx) => {
            let stepClass = 'progress-step';
            let dotClass = 'step-dot';
            if (idx < this.currentProgressStep) {
                stepClass += ' step-done';
                dotClass = 'step-dot-done';
            } else if (idx === this.currentProgressStep) {
                stepClass += ' step-active';
                dotClass = 'step-dot-active';
            }
            return { ...step, stepClass, dotClass };
        });
    }

    get progressBarStyle() {
        const pct = (this.currentProgressStep / (PROGRESS_STEPS.length - 1)) * 100;
        return `width: ${pct}%`;
    }

    // Tab handlers
    handleTabInsights() { this.activeTab = 'insights'; }
    handleTabActions() { this.activeTab = 'actions'; }

    // Transcript toggle
    handleToggleTranscript() { this.isTranscriptExpanded = !this.isTranscriptExpanded; }

    // File upload
    handleChooseFile() {
        const input = this.template.querySelector('.file-input');
        if (input) input.click();
    }

    handleFileSelected(event) {
        const file = event.target.files[0];
        if (file) this._processUploadedFile(file);
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    handleDrop(event) {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file && file.type.startsWith('audio/')) {
            this._processUploadedFile(file);
        } else {
            this.errorMessage = 'Please drop an audio file (MP3, WAV, M4A, etc.)';
        }
    }

    _processUploadedFile(file) {
        this._uploadedFile = file;
        this.uploadedFileName = file.name;
        this.uploadedFileSize = formatFileSize(file.size);
        this.errorMessage = '';
        this.nativeTranscript = '';
        this._clearAnalysis();

        if (this._audioBlobUrl) {
            URL.revokeObjectURL(this._audioBlobUrl);
        }
        this._audioBlobUrl = URL.createObjectURL(file);

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            this._audioElement = this.template.querySelector('.audio-element');
            if (this._audioElement) {
                this._audioElement.src = this._audioBlobUrl;
                this._audioElement.load();
            }
        }, 100);
    }

    handleRemoveFile() {
        if (this._audioBlobUrl) {
            URL.revokeObjectURL(this._audioBlobUrl);
            this._audioBlobUrl = null;
        }
        this._uploadedFile = null;
        this.uploadedFileName = '';
        this.uploadedFileSize = '';
        this._isPlaying = false;
        this._currentTime = 0;
        this._totalTime = 0;
        this._currentTimePercentage = 0;
        this.nativeTranscript = '';
        this.contentDocumentId = '';
        this._clearAnalysis();
    }

    // Audio player
    handlePlayPause() {
        if (!this._audioElement) {
            this._audioElement = this.template.querySelector('.audio-element');
        }
        if (!this._audioElement) return;
        if (this._isPlaying) {
            this._audioElement.pause();
        } else {
            this._audioElement.play().catch(() => {});
        }
    }

    handleOnPlay() { this._isPlaying = true; }
    handleOnPause() { this._isPlaying = false; }

    handleOnTimeUpdate() {
        if (!this._audioElement) return;
        this._currentTime = this._audioElement.currentTime;
        if (this._totalTime > 0) {
            this._currentTimePercentage = (this._currentTime / this._totalTime) * 100;
        }
    }

    handleMetadataLoaded() {
        if (!this._audioElement) {
            this._audioElement = this.template.querySelector('.audio-element');
        }
        if (this._audioElement && !isNaN(this._audioElement.duration)) {
            this._totalTime = this._audioElement.duration;
        }
    }

    handleSeek(event) {
        if (!this._audioElement || !this._totalTime) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const pct = x / rect.width;
        this._audioElement.currentTime = pct * this._totalTime;
    }

    handleSkipBackward() {
        if (!this._audioElement) return;
        this._audioElement.currentTime = Math.max(0, this._audioElement.currentTime - 10);
    }

    handleSkipForward() {
        if (!this._audioElement) return;
        this._audioElement.currentTime = Math.min(this._totalTime, this._audioElement.currentTime + 10);
    }

    handleSpeedChange() {
        const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const idx = speeds.indexOf(this._playbackSpeed);
        this._playbackSpeed = speeds[(idx + 1) % speeds.length];
        if (this._audioElement) {
            this._audioElement.playbackRate = this._playbackSpeed;
        }
    }

    handleVolumeChange(event) {
        this._volume = parseInt(event.target.value, 10);
        if (this._audioElement) {
            this._audioElement.volume = this._volume / 100;
        }
    }

    // Analyse
    async handleAnalyse() {
        if (!this._uploadedFile) {
            this.errorMessage = 'Please upload an audio file first.';
            return;
        }

        this.isAnalysing = true;
        this.currentProgressStep = 0;
        this.errorMessage = '';
        this.nativeTranscript = '';
        this._clearAnalysis();

        try {
            // Step 1: Upload
            this.analysingStatus = 'Uploading audio file';
            this.currentProgressStep = 0;
            const base64 = await blobToBase64(this._uploadedFile);
            const docId = await saveAudioToRecord({
                recordId: this.recordId,
                base64: base64,
                fileName: this._uploadedFile.name,
                title: 'Legal Audio - ' + this._uploadedFile.name
            });
            this.contentDocumentId = docId;

            // Step 2: Transcribe
            this.analysingStatus = 'Transcribing';
            this.currentProgressStep = 1;
            const transcriptResult = await transcribeAudioFile({
                contentDocumentId: docId,
                sourceLanguage: 'hi'
            });
            this.nativeTranscript = transcriptResult;

            // Step 3: Analyse
            this.analysingStatus = 'Generating AI insights';
            this.currentProgressStep = 2;
            this.isInsightLoading = true;
            await this._generateAnalysis(transcriptResult);

            // Done
            this.currentProgressStep = 3;
            this.analysingStatus = 'Analysis complete — insights ready';
            this.pipelineComplete = true;
            this.isTranscriptExpanded = true;

            this.dispatchEvent(new ShowToastEvent({
                title: 'Analysis Complete',
                message: 'Audio transcribed and analysed successfully.',
                variant: 'success'
            }));

        } catch (err) {
            console.error('Analysis error:', err);
            this.errorMessage = 'Analysis failed: ' + (err.body?.message || err.message || 'Unknown error');
            this.dispatchEvent(new ShowToastEvent({
                title: 'Analysis Error',
                message: this.errorMessage,
                variant: 'error',
                mode: 'sticky'
            }));
        } finally {
            this.isAnalysing = false;
        }
    }

    async _generateAnalysis(transcript) {
        try {
            if (!transcript || transcript.trim().length < 10) {
                this.isInsightLoading = false;
                return;
            }

            const result = await generateInsights({
                transcript: transcript,
                recordId: this.recordId
            });

            if (result) {
                let parsed;
                try {
                    let jsonStr = result.trim();
                    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
                    else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
                    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
                    parsed = JSON.parse(jsonStr.trim());
                } catch (e) {
                    parsed = { summary: result };
                }
                this._mapAnalysisResponse(parsed);
            }
        } catch (err) {
            console.error('Insight generation error:', err);
        } finally {
            this.isInsightLoading = false;
        }
    }

    _mapAnalysisResponse(parsed) {
        this.insightSummary = parsed.summary || parsed.Summary || '';
        this.insightSentiment = parsed.sentiment || parsed.Sentiment || '';
        this.sentimentDescription = parsed.sentimentDescription || parsed.sentiment_description || '';
        this.toneAnalysis = parsed.tone || parsed.Tone || parsed.toneAnalysis || parsed.tone_analysis || '';
        this.overallScore = parsed.overallScore || parsed.overall_score || parsed.score || '';

        const keyPoints = parsed.keyPoints || parsed.key_points || parsed.KeyPoints || [];
        this.insightKeyPoints = keyPoints.map((p, i) => ({
            id: `kp-${i}`,
            number: i + 1,
            text: typeof p === 'string' ? p : p.text || p.point
        }));

        const risks = parsed.riskFlags || parsed.risk_flags || parsed.RiskFlags || parsed.risks || [];
        this.insightRiskFlags = risks.map((r, i) => ({
            id: `rf-${i}`,
            text: typeof r === 'string' ? r : r.text || r.flag
        }));

        const improvementList = parsed.improvements || parsed.areasForImprovement || parsed.areas_for_improvement || [];
        this.improvements = improvementList.map((item, i) => ({
            id: `imp-${i}`,
            text: typeof item === 'string' ? item : item.text || item.description
        }));

        this._buildActionCategories(parsed);
    }

    get actionCategoriesWithFields() {
        return this.actionCategories.map(cat => {
            if (cat.createdResult && cat.createdResult.fields) {
                let fieldsList;
                if (Array.isArray(cat.createdResult.fields)) {
                    fieldsList = cat.createdResult.fields.map(f => ({
                        key: f.key,
                        value: String(f.value || '')
                    }));
                } else {
                    fieldsList = Object.keys(cat.createdResult.fields).map(k => ({
                        key: k,
                        value: String(cat.createdResult.fields[k])
                    }));
                }
                const recordId = cat.createdResult.recordId || null;
                const records = cat.createdResult.records || [];
                const recordLinks = [];
                if (recordId) {
                    recordLinks.push({ id: recordId, label: cat.createdResult.recordType || 'Record', url: `/lightning/r/${recordId}/view` });
                }
                if (records.length) {
                    records.forEach(rec => {
                        if (rec.id) {
                            recordLinks.push({ id: rec.id, label: `${rec.type}: ${rec.subject || ''}`, url: `/lightning/r/${rec.id}/view` });
                        }
                    });
                }
                return { ...cat, createdFieldsList: fieldsList, recordLinks, hasRecordLinks: recordLinks.length > 0 };
            }
            return { ...cat, createdFieldsList: [], recordLinks: [], hasRecordLinks: false };
        });
    }

    _buildActionCategories(parsed) {
        const categories = parsed.actionCategories || parsed.action_categories || parsed.actions || null;
        if (!categories) {
            this.actionCategories = [];
            return;
        }

        const categoryOrder = ['matter_intake', 'party_extraction', 'conflict_reassessment', 'obligation_deadlines', 'missing_information', 'risk_governance'];
        const result = [];

        const displayOnlyKeys = ['party_extraction', 'missing_information'];

        if (Array.isArray(categories)) {
            categories.forEach((cat, idx) => {
                const key = cat.key || cat.category || categoryOrder[idx] || `cat_${idx}`;
                const isDisplayOnly = displayOnlyKeys.includes(key);
                const actions = (cat.actions || cat.items || []).map((a, ai) => ({
                    id: `${key}-${ai}`,
                    text: typeof a === 'string' ? a : a.text || a.description || a.action,
                    isCreated: false
                }));
                result.push({
                    id: key,
                    title: cat.title || CATEGORY_LABELS[key] || key,
                    icon: CATEGORY_ICONS[key] || 'utility:record_create',
                    triggeredBy: cat.triggeredBy || cat.triggered_by || '',
                    count: actions.length,
                    actions: actions,
                    isExpanded: idx === 0,
                    isCreated: false,
                    isDisplayOnly,
                    createBtnLabel: CATEGORY_BTN_LABELS[key] || 'Create Record',
                    chevronIcon: idx === 0 ? 'utility:chevrondown' : 'utility:chevronright'
                });
            });
        } else if (typeof categories === 'object') {
            categoryOrder.forEach(key => {
                if (categories[key]) {
                    const catData = categories[key];
                    const isDisplayOnly = displayOnlyKeys.includes(key);
                    const actions = (catData.actions || catData.items || []).map((a, ai) => ({
                        id: `${key}-${ai}`,
                        text: typeof a === 'string' ? a : a.text || a.description || a.action,
                        isCreated: false
                    }));
                    if (actions.length > 0) {
                        result.push({
                            id: key,
                            title: catData.title || CATEGORY_LABELS[key] || key,
                            icon: CATEGORY_ICONS[key] || 'utility:record_create',
                            triggeredBy: catData.triggeredBy || catData.triggered_by || '',
                            count: actions.length,
                            actions: actions,
                            isExpanded: result.length === 0,
                            isCreated: false,
                            isDisplayOnly,
                            createBtnLabel: CATEGORY_BTN_LABELS[key] || 'Create Record',
                            chevronIcon: result.length === 0 ? 'utility:chevrondown' : 'utility:chevronright'
                        });
                    }
                }
            });
        }

        this.actionCategories = result;
    }

    handleToggleCategory(event) {
        const catId = event.currentTarget.dataset.categoryId;
        this.actionCategories = this.actionCategories.map(cat => {
            if (cat.id === catId) {
                const expanded = !cat.isExpanded;
                return {
                    ...cat,
                    isExpanded: expanded,
                    chevronIcon: expanded ? 'utility:chevrondown' : 'utility:chevronright'
                };
            }
            return cat;
        });
    }

    async handleCreateCategoryRecord(event) {
        const categoryId = event.currentTarget.dataset.categoryId;
        const category = this.actionCategories.find(c => c.id === categoryId);
        if (!category) return;

        this.actionCategories = this.actionCategories.map(cat => {
            if (cat.id === categoryId) {
                return { ...cat, isCreating: true };
            }
            return cat;
        });

        try {
            const categoryData = JSON.stringify({
                actions: category.actions.map(a => a.text),
                triggeredBy: category.triggeredBy || ''
            });

            const resultJson = await createActionRecord({
                recordId: this.recordId,
                categoryKey: categoryId,
                categoryData: categoryData
            });

            const result = JSON.parse(resultJson);

            this.actionCategories = this.actionCategories.map(cat => {
                if (cat.id === categoryId) {
                    return {
                        ...cat,
                        isCreated: true,
                        isCreating: false,
                        createdResult: result
                    };
                }
                return cat;
            });

            this.dispatchEvent(new ShowToastEvent({
                title: 'Record Created',
                message: `${category.title} — ${result.recordType} created successfully.`,
                variant: 'success'
            }));
        } catch (err) {
            this.actionCategories = this.actionCategories.map(cat => {
                if (cat.id === categoryId) {
                    return { ...cat, isCreating: false };
                }
                return cat;
            });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Creation Failed',
                message: err.body?.message || err.message || 'Unknown error',
                variant: 'error'
            }));
        }
    }

    _clearAnalysis() {
        this.insightSummary = '';
        this.insightKeyPoints = [];
        this.insightRiskFlags = [];
        this.insightSentiment = '';
        this.toneAnalysis = '';
        this.sentimentDescription = '';
        this.overallScore = '';
        this.improvements = [];
        this.actionCategories = [];
        this.activeTab = 'insights';
        this.currentProgressStep = 0;
        this.pipelineComplete = false;
        this.analysingStatus = '';
    }

    dismissError() { this.errorMessage = ''; }

    disconnectedCallback() {
        if (this._audioBlobUrl) {
            URL.revokeObjectURL(this._audioBlobUrl);
            this._audioBlobUrl = null;
        }
    }
}
