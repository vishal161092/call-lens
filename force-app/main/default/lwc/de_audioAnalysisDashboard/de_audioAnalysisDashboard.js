import { LightningElement, api, wire, track } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';

const LEAD_FIELD = 'Lead.Audio_Analysis__c';
const LEAD_ID_FIELD = 'Lead.Id';
const AGENT_FIELD = 'Lead.Agent_Name__c';

export default class DeAudioAnalysisDashboard extends LightningElement {
    @api recordId; // Lead record ID passed from the page
    
    @track currentTab = 'overview';
    @track audioAnalysisData = null;
    @track error = null;
    
    // Computed properties for data
    overallScore = '0.0';
    qualityScoresArray = [];
    improvementsArray = [];
    kpiEvaluationsArray = [];
    kpiStats = { yes: 0, partial: 0, no: 0 };
    
    customerIntent = '';
    sentiment = '';
    interactionSummary = '';
    agentName = '';

    // Wire service to get Lead record
    @wire(getRecord, { recordId: '$recordId', fields: [LEAD_FIELD, LEAD_ID_FIELD, AGENT_FIELD] })
    wiredLead({ error, data }) {
        if (data) {
            try {
                this.agentName = data.fields.Agent_Name__c?.value || '';
                const audioAnalysisJson = data.fields.Audio_Analysis__c?.value;
                if (audioAnalysisJson) {
                    this.audioAnalysisData = JSON.parse(audioAnalysisJson);
                    this.processData();
                } else {
                    this.error = 'No audio analysis data found on this Lead record.';
                }
            } catch (err) {
                this.error = 'Error parsing audio analysis data: ' + err.message;
                console.error('Error parsing JSON:', err);
            }
        } else if (error) {
            this.error = 'Error loading Lead record: ' + error.body?.message;
            console.error('Error loading Lead:', error);
        }
    }

    // Process the parsed JSON data
    processData() {
        if (!this.audioAnalysisData) return;
        
        // Calculate overall score
        const scores = Object.values(this.audioAnalysisData.qualityScores || {}).map(s => s.score);
        if (scores.length > 0) {
            this.overallScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        }
        
        // Process quality scores
        this.processQualityScores();
        
        // Process AI insights
        this.processInsights();
        
        // Process KPI evaluations
        this.processKpis();
        
        // Render chart after data is processed
        this.renderedCallback();
    }

    processQualityScores() {
        if (!this.audioAnalysisData.qualityScores) return;
        
        this.qualityScoresArray = Object.entries(this.audioAnalysisData.qualityScores).map(([key, value]) => {
            const score = value.score || 0;
            let borderClass = 'score-item score-item-default';
            if (score >= 4) {
                borderClass = 'score-item score-item-success';
            } else if (score >= 3) {
                borderClass = 'score-item score-item-warning';
            } else {
                borderClass = 'score-item score-item-error';
            }
            
            const pct = Math.max(0, Math.min(100, (score / 5) * 100));
            const barColor = this.getScoreColor(score);
            return {
                key: key,
                label: this.capitalize(key),
                score: score,
                justification: value.justification || '',
                scoreClass: this.getScoreColorClass(score),
                itemClass: `slds-m-bottom_medium ${borderClass}`,
                barFillStyle: `width:${pct}%;background:${barColor};`
            };
        });
    }

    processInsights() {
        if (!this.audioAnalysisData.aiInsights) return;
        
        const insights = this.audioAnalysisData.aiInsights;
        this.customerIntent = insights.customerIntent || '';
        this.sentiment = insights.sentiment || '';
        this.interactionSummary = insights.interactionSummary || '';
        
        // Process improvements
        if (insights.scopeOfImprovement && Array.isArray(insights.scopeOfImprovement)) {
            this.improvementsArray = insights.scopeOfImprovement.map((text, index) => ({
                key: `improvement-${index}`,
                text: text,
                index: index + 1
            }));
        }
    }

    processKpis() {
        if (!this.audioAnalysisData.kpiEvaluations) return;
        
        // Calculate KPI stats
        const kpis = this.audioAnalysisData.kpiEvaluations;
        this.kpiStats = {
            yes: kpis.filter(k => k.answer === 'Yes').length,
            partial: kpis.filter(k => k.answer === 'Partial').length,
            no: kpis.filter(k => k.answer === 'No').length
        };
        
        // Process KPI details
        this.kpiEvaluationsArray = kpis.map((kpi, index) => {
            const answer = kpi.answer || 'No';
            return {
                key: `kpi-${index}`,
                kpiQuestion: kpi.kpiQuestion || '',
                answer: answer,
                justification: kpi.justification || '',
                evidence: kpi.evidence || '',
                iconName: this.getKpiIcon(answer),
                iconClass: this.getKpiIconClass(answer),
                badgeClass: this.getKpiBadgeClass(answer)
            };
        });
    }

    // Tab handling
    handleTabClick(event) {
        event.preventDefault();
        const tab = event.currentTarget.dataset.tab;
        this.currentTab = tab;
    }

    // Getters for tab classes
    get overviewTabClass() {
        return this.currentTab === 'overview' 
            ? 'slds-tabs_default__item slds-is-active' 
            : 'slds-tabs_default__item';
    }

    get insightsTabClass() {
        return this.currentTab === 'insights' 
            ? 'slds-tabs_default__item slds-is-active' 
            : 'slds-tabs_default__item';
    }

    get kpisTabClass() {
        return this.currentTab === 'kpis' 
            ? 'slds-tabs_default__item slds-is-active' 
            : 'slds-tabs_default__item';
    }

    get overviewContentClass() {
        return this.currentTab === 'overview' 
            ? 'slds-tabs_default__content slds-show' 
            : 'slds-tabs_default__content slds-hide';
    }

    get insightsContentClass() {
        return this.currentTab === 'insights' 
            ? 'slds-tabs_default__content slds-show' 
            : 'slds-tabs_default__content slds-hide';
    }

    get kpisContentClass() {
        return this.currentTab === 'kpis' 
            ? 'slds-tabs_default__content slds-show' 
            : 'slds-tabs_default__content slds-hide';
    }

    // Getters for computed properties
    get hasQualityScores() {
        return this.qualityScoresArray && this.qualityScoresArray.length > 0;
    }

    get hasImprovements() {
        return this.improvementsArray && this.improvementsArray.length > 0;
    }

    get hasKpiEvaluations() {
        return this.kpiEvaluationsArray && this.kpiEvaluationsArray.length > 0;
    }

    get hasAgent() {
        return !!this.agentName;
    }

    get overallScoreClass() {
        const score = parseFloat(this.overallScore);
        if (score >= 4) return 'slds-text-color_success';
        if (score >= 3) return 'slds-text-color_warning';
        return 'slds-text-color_error';
    }

    get scoreCircleClass() {
        const score = parseFloat(this.overallScore);
        if (score >= 4) return 'qa-score-circle qa-score-high';
        if (score >= 3) return 'qa-score-circle qa-score-mid';
        return 'qa-score-circle qa-score-low';
    }

    // Ring: circumference = 2*pi*r (r=42) ≈ 263.9; offset shrinks as score rises.
    get ringFillStyle() {
        const score = parseFloat(this.overallScore) || 0;
        const circumference = 263.9;
        const offset = circumference * (1 - Math.max(0, Math.min(5, score)) / 5);
        return `stroke:${this.getScoreColor(score)};stroke-dasharray:${circumference};stroke-dashoffset:${offset.toFixed(1)};`;
    }

    get statusLabel() {
        const score = parseFloat(this.overallScore) || 0;
        if (score >= 4) return 'Excellent';
        if (score >= 3) return 'Good';
        if (score >= 2) return 'Needs Work';
        return 'Poor';
    }

    get statusClass() {
        const score = parseFloat(this.overallScore) || 0;
        if (score >= 4) return 'vb-status vb-status-high';
        if (score >= 3) return 'vb-status vb-status-mid';
        return 'vb-status vb-status-low';
    }

    // Utility functions
    capitalize(str) {
        return str.replace(/([A-Z])/g, ' $1').trim().replace(/^./, s => s.toUpperCase());
    }

    getScoreColorClass(score) {
        if (score >= 4) return 'slds-text-color_success slds-text-heading_small';
        if (score >= 3) return 'slds-text-color_warning slds-text-heading_small';
        return 'slds-text-color_error slds-text-heading_small';
    }

    getScoreColor(score) {
        if (score >= 4) return '#10b981'; // green
        if (score >= 3) return '#f59e0b'; // amber
        return '#ef4444'; // red
    }

    getKpiIcon(answer) {
        if (answer === 'Yes') return 'utility:success';
        if (answer === 'Partial') return 'utility:warning';
        return 'utility:error';
    }

    getKpiIconClass(answer) {
        if (answer === 'Yes') return 'slds-icon-text-success';
        if (answer === 'Partial') return 'slds-icon-text-warning';
        return 'slds-icon-text-error';
    }

    getKpiBadgeClass(answer) {
        if (answer === 'Yes') return 'slds-badge slds-badge_success';
        if (answer === 'Partial') return 'slds-badge slds-badge_warning';
        return 'slds-badge slds-badge_error';
    }

    // Chart rendering
    renderedCallback() {
        if (!this.audioAnalysisData || !this.hasQualityScores) return;
        
        // Wait for DOM to be ready
        setTimeout(() => {
            this.renderChart();
        }, 100);
    }

    connectedCallback() {
        // Add resize listener to redraw chart on window resize
        this.resizeHandler = () => {
            if (this.audioAnalysisData && this.hasQualityScores) {
                setTimeout(() => {
                    this.renderChart();
                }, 100);
            }
        };
        window.addEventListener('resize', this.resizeHandler);
    }

    disconnectedCallback() {
        // Clean up resize listener
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        
        // Clean up any blob URLs if they exist
        if (this.audioBlobUrl) {
            URL.revokeObjectURL(this.audioBlobUrl);
        }
    }

    renderChart() {
        const canvas = this.template.querySelector('.quality-chart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        
        // Set canvas size with device pixel ratio for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = 400 * dpr;
        ctx.scale(dpr, dpr);
        
        const labels = this.qualityScoresArray.map(item => item.label);
        const scores = this.qualityScoresArray.map(item => item.score);
        const colors = scores.map(score => this.getScoreColor(score));
        
        const maxScore = 5;
        // More padding on left for labels, less on bottom since we're using horizontal bars
        const padding = { top: 20, right: 50, bottom: 20, left: 180 };
        const chartWidth = canvas.width / dpr - padding.left - padding.right;
        const chartHeight = canvas.height / dpr - padding.top - padding.bottom;
        const chartTop = padding.top;
        const chartBottom = chartTop + chartHeight;
        const chartLeft = padding.left;
        const chartRight = chartLeft + chartWidth;
        
        // Clear canvas with white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        
        // Calculate bar dimensions - horizontal bars
        const barHeight = 35;
        const barSpacing = 15;
        const totalBarHeight = barHeight + barSpacing;
        const startY = chartTop + (chartHeight - (labels.length * totalBarHeight - barSpacing)) / 2;
        
        // Draw grid lines (vertical for horizontal bars)
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 1;
        for (let i = 0; i <= maxScore; i++) {
            const x = chartLeft + (i / maxScore) * chartWidth;
            ctx.beginPath();
            ctx.moveTo(x, chartTop);
            ctx.lineTo(x, chartBottom);
            ctx.stroke();
        }
        
        // Draw horizontal bars
        labels.forEach((label, index) => {
            const score = scores[index];
            const color = colors[index];
            const barWidth = (score / maxScore) * chartWidth;
            const y = startY + (index * totalBarHeight);
            
            // Draw bar background (gray, full width)
            ctx.fillStyle = '#f0f0f0';
            this.drawRoundedRect(ctx, chartLeft, y, chartWidth, barHeight, 6);
            ctx.fill();
            
            // Draw filled bar with rounded corners
            ctx.fillStyle = color;
            this.drawRoundedRect(ctx, chartLeft, y, barWidth, barHeight, 6);
            ctx.fill();
            
            // Draw score label inside bar (right-aligned if bar is wide enough, otherwise outside)
            if (barWidth > 50) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 13px sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(score.toFixed(1), chartLeft + barWidth - 10, y + barHeight / 2);
            } else {
                ctx.fillStyle = '#333333';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(score.toFixed(1), chartLeft + barWidth + 8, y + barHeight / 2);
            }
            
            // Draw label on the left side (full width available)
            ctx.fillStyle = '#333333';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            
            // Truncate label if too long, but show full text if possible
            const maxLabelWidth = padding.left - 20;
            let displayLabel = label;
            
            // Measure text width
            ctx.font = '12px sans-serif';
            const metrics = ctx.measureText(label);
            if (metrics.width > maxLabelWidth) {
                // Truncate with ellipsis
                let truncated = label;
                while (ctx.measureText(truncated + '...').width > maxLabelWidth && truncated.length > 0) {
                    truncated = truncated.slice(0, -1);
                }
                displayLabel = truncated + '...';
            }
            
            ctx.fillText(displayLabel, chartLeft - 10, y + barHeight / 2);
        });
        
        // Draw X-axis line (top line for horizontal bars)
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(chartLeft, chartTop);
        ctx.lineTo(chartRight, chartTop);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(chartLeft, chartBottom);
        ctx.lineTo(chartRight, chartBottom);
        ctx.stroke();
        
        // Draw X-axis labels (score values at top)
        ctx.fillStyle = '#666666';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let i = 0; i <= maxScore; i++) {
            const x = chartLeft + (i / maxScore) * chartWidth;
            ctx.fillText(i.toString(), x, chartTop - 5);
        }
        
        // Draw axis label
        ctx.fillStyle = '#666666';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Score', chartLeft + chartWidth / 2, chartBottom + 5);
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height);
        ctx.lineTo(x, y + height);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
}
