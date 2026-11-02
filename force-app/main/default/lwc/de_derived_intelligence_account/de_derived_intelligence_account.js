import { LightningElement, api } from 'lwc';
import getDerivedIntelligence from '@salesforce/apex/de_derived_intelligence_account_apex.getDerivedIntelligence';

export default class DeDerivedIntelligenceAccount extends LightningElement {
    _recordId;
    @api get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        this._recordId = value;
        if (value) this.loadData();
    }

    reportData = null;
    error = null;
    isLoading = false;
    loadingProgress = 0;
    _progressTimer;

    // Topbar
    topbarSubtitle = 'Holistic visit analysis';
    topbarChips = [];

    // Demand shift signals
    demandShiftSignals = [];
    demandShiftCount = 0;

    // Margin & competitive
    marginCompetitiveSignals = [];
    marginCompetitiveCount = 0;

    // Credit behavior
    creditRequestFrequency = '0';
    creditTrendDirection = '';
    creditTrendArrow = '';
    workingCapitalDisplay = '';
    workingCapitalLabel = '';
    creditTermDisplay = '';
    creditJustification = '';

    // Strategic implications
    strategicImplicationCards = [];
    strategicImplicationsCount = 0;

    connectedCallback() {
        if (this._recordId) this.loadData();
    }

    loadData() {
        if (!this.recordId) {
            this.error = 'No Account record ID available.';
            return;
        }
        this.isLoading = true;
        this.error = null;
        this._startProgress();
        getDerivedIntelligence({ accountId: this.recordId })
            .then((rawText) => {
                if (!rawText || rawText.trim() === '') {
                    this.error = 'No derived intelligence data returned.';
                    this.reportData = null;
                    return;
                }
                try {
                    // Strip markdown code blocks if present
                    let jsonStr = rawText.trim();
                    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                    if (codeBlockMatch) {
                        jsonStr = codeBlockMatch[1].trim();
                    }
                    this.reportData = JSON.parse(jsonStr);
                    this.error = null;
                    this.processData();
                } catch (err) {
                    this.error = 'Error parsing response: ' + err.message;
                    console.error('JSON parse error:', err, 'rawText:', rawText?.substring(0, 500));
                }
            })
            .catch((err) => {
                this.error = err.body?.message || err.message || 'Error loading derived intelligence';
            })
            .finally(() => {
                this._stopProgress();
                this.isLoading = false;
            });
    }

    // Animate an indeterminate-style progress bar: climb toward 90% while the
    // prompt generates, then snap to 100% when the response resolves.
    _startProgress() {
        this.loadingProgress = 0;
        this._clearProgressTimer();
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._progressTimer = setInterval(() => {
            if (this.loadingProgress < 90) {
                this.loadingProgress += Math.max(1, Math.round((90 - this.loadingProgress) / 8));
            }
        }, 400);
    }

    _stopProgress() {
        this._clearProgressTimer();
        this.loadingProgress = 100;
    }

    _clearProgressTimer() {
        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = undefined;
        }
    }

    disconnectedCallback() {
        this._clearProgressTimer();
    }

    processData() {
        if (!this.reportData) return;

        const ai = this.reportData.account360DerivedIntelligence || {};
        const strat = this.reportData.strategicImplications || {};

        // Topbar chips
        this.topbarChips = this._buildTopbarChips(ai);

        // Demand shift signals
        const demandShift = ai.demandShiftSignals || {};
        this.demandShiftSignals = this._mapSignalGroup(demandShift, {
            skuVelocityShiftTrend: 'SKU Velocity Shift',
            categorySlowMovementTrend: 'Category Slow Movement',
            seasonalDemandShiftTrend: 'Seasonal Demand Shift'
        }, '— No Trend');
        this.demandShiftCount = this.demandShiftSignals.length;

        // Margin & competitive pressure (use "Isolated" for no-trend)
        const marginComp = ai.marginAndCompetitivePressureTrend || {};
        this.marginCompetitiveSignals = this._mapSignalGroup(marginComp, {
            marginPressureIncreasing: 'Margin Pressure',
            competitiveDiscountRecurring: 'Competitive Discount'
        }, '— Isolated');
        this.marginCompetitiveCount = this.marginCompetitiveSignals.length;

        // Credit behavior
        const credit = ai.creditBehaviorTrend || {};
        this.creditRequestFrequency = credit.creditRequestFrequency ?? '0';
        this.creditTrendDirection = credit.trendDirection ?? '';
        this.creditTrendArrow = (credit.trendDirection || '').toLowerCase().includes('increas') ? '↑' : credit.trendDirection ? '↓' : '—';
        this.workingCapitalDisplay = credit.workingCapitalPressureSignal === 'Yes' ? 'Yes' : 'None';
        this.workingCapitalLabel = credit.workingCapitalPressureSignal === 'Yes' ? 'Signal' : 'No Signal';
        this.creditTermDisplay = this._extractCreditTerm(credit.justification) || '—';
        this.creditJustification = this._humanize(credit.justification);

        // Strategic implications
        const domainConfig = [
            { key: 'sales', title: 'Sales', icon: '📈', domainClass: 'domain-sales' },
            { key: 'tradeMarketing', title: 'Trade Marketing', icon: '🏷️', domainClass: 'domain-trade' },
            { key: 'supplyChain', title: 'Supply Chain', icon: '🚚', domainClass: 'domain-supply' },
            { key: 'finance', title: 'Finance', icon: '💰', domainClass: 'domain-finance' },
            { key: 'categoryTeam', title: 'Category Team', icon: '📦', domainClass: 'domain-category' }
        ];
        this.strategicImplicationCards = domainConfig
            .filter((d) => strat[d.key] && strat[d.key].length > 0)
            .map((d) => ({
                key: d.key,
                title: d.title,
                icon: d.icon,
                cardClass: `impl-card ${d.domainClass}`,
                items: strat[d.key].map((text, i) => ({ key: `${d.key}-${i}`, text: this._humanize(text) }))
            }));
        this.strategicImplicationsCount = this.strategicImplicationCards.length;
    }

    _buildTopbarChips(ai) {
        const chips = [];
        const demand = ai.demandShiftSignals || {};
        if (demand.skuVelocityShiftTrend?.trendDetected === 'Yes') {
            chips.push({ key: 'sku-velocity', label: 'SKU Velocity ↑ Trend', chipClass: 'chip chip-blue' });
        }
        const credit = ai.creditBehaviorTrend || {};
        if ((credit.trendDirection || '').toLowerCase().includes('increas')) {
            chips.push({ key: 'credit', label: 'Credit Increasing', chipClass: 'chip chip-amber' });
        }
        if (credit.workingCapitalPressureSignal === 'No' || !credit.workingCapitalPressureSignal) {
            chips.push({ key: 'cash', label: 'No Cash Pressure', chipClass: 'chip chip-green' });
        }
        return chips;
    }

    _mapSignalGroup(group, labelMap, noTrendLabel = '— No Trend') {
        return Object.entries(group)
            .filter(([, v]) => v && typeof v === 'object')
            .map(([key, v]) => {
                const trendDetected = v.trendDetected === 'Yes';
                const evidenceCount = String(v.evidenceCount ?? '0');
                return {
                    key,
                    label: labelMap[key] || key,
                    trendLabel: trendDetected ? '▲ Trend Detected' : noTrendLabel,
                    trendClass: trendDetected ? 'signal-trend trend-yes' : 'signal-trend trend-no',
                    evidenceClass: trendDetected ? 'signal-evidence' : 'signal-evidence signal-evidence-muted',
                    evidenceDotClass: trendDetected ? 'evidence-dot' : 'evidence-dot evidence-dot-muted',
                    evidenceCount,
                    evidenceText: `${evidenceCount} visit${evidenceCount === '1' ? '' : 's'} ${trendDetected ? 'confirmed' : 'only'}`,
                    justification: this._humanize(v.justification)
                };
            });
    }

    // The grounding prompt references raw JSON field paths (e.g.
    // skuVelocityInsight.signalDetected, marginSensitiveOutlet) and the model
    // occasionally echoes them verbatim into justification text. Rewrite those
    // into plain business language for display.
    _humanize(text) {
        if (!text || typeof text !== 'string') return text || '';
        let out = text;
        // Most-specific phrase replacements first.
        const phraseMap = [
            [/salesExecutionInsights\.skuVelocityInsight\.signalDetected/gi, 'SKU velocity signal'],
            [/skuVelocityInsight\.signalDetected/gi, 'SKU velocity signal'],
            [/skuVelocityInsight/gi, 'SKU velocity signal'],
            [/supplyChainInsights\.categoryMovementSignal\.slowMovementDetected/gi, 'category slow-movement signal'],
            [/categoryMovementSignal\.slowMovementDetected/gi, 'category slow-movement signal'],
            [/tradeSchemeInsights\.competitiveDiscountPressure\.severity/gi, 'competitive discount pressure'],
            [/competitiveDiscountPressure\.severity/gi, 'competitive discount pressure'],
            [/competitiveDiscountPressure/gi, 'competitive discount pressure'],
            [/marginSensitivityFlag/gi, 'margin-sensitivity flag'],
            [/marginSensitiveOutlet/gi, 'margin-sensitive outlet'],
            [/workingCapitalPressureSignal/gi, 'working-capital pressure'],
            [/creditRequestFrequency/gi, 'credit requests'],
            [/slowMovementDetected/gi, 'slow-movement signal'],
            [/signalDetected/gi, 'signal']
        ];
        phraseMap.forEach(([re, rep]) => {
            out = out.replace(re, rep);
        });
        // Generic fallback: any remaining dotted JSON path that looks like a
        // camelCase identifier (not ordinary prose such as "visits.The").
        out = out.replace(/\b[a-zA-Z]+(?:\.[a-zA-Z]+)+\b/g, (m) => {
            if (!/[a-z][A-Z]/.test(m)) return m;
            return this._decamelize(m.split('.').pop());
        });
        return out;
    }

    _decamelize(word) {
        return word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    }

    _extractCreditTerm(justification) {
        if (!justification) return '';
        const m = justification.match(/(\d+)\s*day/i) || justification.match(/(\d+)\s*d\b/i);
        return m ? m[1] + 'd' : '';
    }

    get hasData() {
        return this.reportData && !this.error && !this.isLoading;
    }

    get creditStat1Style() {
        return 'color:var(--amber)';
    }
    get creditStat2Style() {
        return 'color:var(--blue)';
    }
    get creditStat3Style() {
        return 'color:var(--green)';
    }
    get creditTrendChipClass() {
        return 'chip chip-amber';
    }
    get workingCapitalChipClass() {
        return this.reportData?.account360DerivedIntelligence?.creditBehaviorTrend?.workingCapitalPressureSignal === 'Yes'
            ? 'chip chip-red'
            : 'chip chip-green';
    }
}