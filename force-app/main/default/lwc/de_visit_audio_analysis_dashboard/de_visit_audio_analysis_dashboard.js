import { LightningElement, api } from 'lwc';
import getAudioAnalysisData from '@salesforce/apex/de_visit_audio_analysis_dashboard_apex.getAudioAnalysisData';

export default class DeVisitAudioAnalysisDashboard extends LightningElement {
    _recordId;
    @api get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        console.log('[de_visit_audio_analysis_dashboard] recordId setter called, value:', value, 'type:', typeof value);
        this._recordId = value;
        if (value) this.loadData();
    }

    currentTab = 'summary';
    reportData = null;
    error = null;
    isLoading = true;

    headerBadges = [];
    kpis = [];
    orderSummary = [];
    retailerFeedback = [];
    competitiveSignal = {};
    commercialAffinity = {};
    salesExecutionCards = [];
    tradeSchemeCards = [];
    supplyChainCards = [];
    positiveBehaviors = [];
    coachingOpportunities = [];
    nextVisitRecommendation = '';

    connectedCallback() {
        console.log('[de_visit_audio_analysis_dashboard] connectedCallback, _recordId:', this._recordId);
        if (this._recordId) this.loadData();
    }

    loadData() {
        console.log('[de_visit_audio_analysis_dashboard] loadData called, recordId:', this.recordId);
        if (!this.recordId) {
            console.warn('[de_visit_audio_analysis_dashboard] No recordId - aborting load');
            this.error = 'No Visit record ID available.';
            this.isLoading = false;
            return;
        }
        console.log('[de_visit_audio_analysis_dashboard] Calling Apex getAudioAnalysisData for visitId:', this.recordId);
        this.isLoading = true;
        this.error = null;
        getAudioAnalysisData({ visitId: this.recordId })
            .then((data) => {
                console.log('[de_visit_audio_analysis_dashboard] Apex returned, data type:', typeof data, 'data length:', data?.length, 'data preview:', data ? String(data).substring(0, 150) : data);
                if (data === null || data === undefined || data === '') {
                    console.warn('[de_visit_audio_analysis_dashboard] Apex returned empty/null data');
                    this.error = 'No audio analysis data found on this Visit record.';
                    this.reportData = null;
                } else {
                    try {
                        this.reportData = JSON.parse(data);
                        this.error = null;
                        console.log('[de_visit_audio_analysis_dashboard] JSON parsed successfully, keys:', Object.keys(this.reportData));
                        this.processData();
                    } catch (err) {
                        this.error = 'Error parsing audio analysis data: ' + err.message;
                        console.error('[de_visit_audio_analysis_dashboard] JSON parse error:', err);
                    }
                }
            })
            .catch((err) => {
                console.error('[de_visit_audio_analysis_dashboard] Apex catch - full error:', err, 'body:', err?.body, 'message:', err?.body?.message || err?.message);
                this.error = 'Error loading Visit record: ' + (err.body?.message || err.message);
            })
            .finally(() => {
                this.isLoading = false;
                console.log('[de_visit_audio_analysis_dashboard] loadData complete, hasData:', !!this.reportData, 'error:', this.error);
            });
    }

    processData() {
        console.log('[de_visit_audio_analysis_dashboard] processData called, reportData exists:', !!this.reportData);
        if (!this.reportData) return;

        const d = this.reportData;
        console.log('[de_visit_audio_analysis_dashboard] processData - summary:', !!d.summary, 'orderSummary count:', d.summary?.orderSummary?.length);
        const summary = d.summary || {};
        const salesExec = d.salesExecutionInsights || {};
        const tradeScheme = d.tradeSchemeInsights || {};
        const supplyChain = d.supplyChainInsights || {};
        const affinity = d.retailerAffinity || {};
        const dsr = d.dsrPerformance || {};

        // Header badges - derive from data
        this.headerBadges = this._buildHeaderBadges(summary, affinity, tradeScheme);

        // KPIs - derive from data
        this.kpis = this._buildKpis(summary, affinity);

        // Order summary
        this.orderSummary = summary.orderSummary || [];

        // Retailer feedback
        const feedbackArr = summary.retailerFeedback || [];
        this.retailerFeedback = feedbackArr.map((f, i) => ({
            key: `fb-${i}`,
            text: typeof f === 'string' ? f : f.text,
            dotClass: 'feedback-dot'
        }));

        // Competitive signal
        const comp = summary.competitiveSignal || {};
        this.competitiveSignal = {
            discountMentioned: comp.discountMentioned,
            marginAdvantageCited: comp.marginAdvantageMentioned || comp.marginAdvantageCited,
            details: comp.details
        };

        // Commercial & Affinity - merge summary.commercial + retailerAffinity
        const commercial = summary.commercial || {};
        this.commercialAffinity = {
            creditRequested: commercial.creditRequested,
            creditDays: commercial.creditDays ? commercial.creditDays + (commercial.creditDays.match(/\d/) ? '' : ' days') : null,
            affinityScore: affinity.affinityScore,
            switchRisk: affinity.switchRisk,
            justification: commercial.justification || affinity.justification
        };

        // Sales execution cards
        this.salesExecutionCards = [
            this._mapSkuVelocity(salesExec.skuVelocityInsight),
            this._mapPackSizeElasticity(salesExec.packSizeElasticity),
            this._mapUpsellOpportunity(salesExec.upsellOpportunity)
        ].filter(Boolean);

        // Trade scheme cards
        this.tradeSchemeCards = [
            this._mapCompetitiveDiscountPressure(tradeScheme.competitiveDiscountPressure),
            this._mapMarginSensitivityFlag(tradeScheme.marginSensitivityFlag)
        ].filter(Boolean);

        // Supply chain cards
        this.supplyChainCards = [
            this._mapCategoryMovementSignal(supplyChain.categoryMovementSignal),
            this._mapCreditBehaviorPattern(supplyChain.creditBehaviorPattern)
        ].filter(Boolean);

        // DSR performance
        this.positiveBehaviors = (dsr.positiveBehaviors || []).map((b, i) => ({
            key: `pb-${i}`,
            text: typeof b === 'string' ? b : b.text
        }));
        this.coachingOpportunities = (dsr.coachingOpportunities || []).map((b, i) => ({
            key: `co-${i}`,
            text: typeof b === 'string' ? b : b.text
        }));
        this.nextVisitRecommendation = dsr.nextVisitRecommendation || '';
    }

    _buildHeaderBadges(summary, affinity, tradeScheme) {
        const badges = [];
        const comp = summary.competitiveSignal || {};
        if (comp.discountMentioned === 'Yes' || comp.marginAdvantageMentioned === 'Yes') {
            badges.push({ label: 'High Competitive Pressure', type: 'red', badgeClass: 'badge badge-red' });
        }
        const marginFlag = tradeScheme.marginSensitivityFlag || {};
        if (marginFlag.loyaltyRiskScore === 'Moderate') {
            badges.push({ label: 'Moderate Loyalty Risk', type: 'amber', badgeClass: 'badge badge-amber' });
        }
        const commercial = summary.commercial || {};
        if (commercial.creditDays) {
            badges.push({ label: `Credit: ${commercial.creditDays} Days`, type: 'green', badgeClass: 'badge badge-green' });
        }
        if (affinity.affinityScore) {
            badges.push({ label: `Affinity: ${affinity.affinityScore}`, type: 'blue', badgeClass: 'badge badge-blue' });
        }
        return badges;
    }

    _buildKpis(summary, affinity) {
        const kpis = [];
        const orderSummary = summary.orderSummary || [];
        if (orderSummary.length > 0) {
            kpis.push({ value: String(orderSummary.length), label: 'Products Ordered', color: 'blue', colorStyle: 'color:#2563eb' });
        }
        const commercial = summary.commercial || {};
        if (commercial.creditDays) {
            kpis.push({ value: commercial.creditDays, label: 'Credit Days', color: 'green', colorStyle: 'color:#16a34a' });
        }
        if (affinity.affinityScore) {
            kpis.push({ value: affinity.affinityScore, label: 'Affinity Score', color: 'blue', colorStyle: 'color:#2563eb' });
        }
        return kpis;
    }

    _mapSkuVelocity(obj) {
        if (!obj) return null;
        return {
            title: 'SKU Velocity',
            signalLabel: obj.signalDetected === 'Yes' ? 'Signal Detected' : null,
            signalPillClass: this._signalPillClass(obj.signalDetected === 'Yes' ? 'yes' : 'no'),
            body: obj.insight || '',
            actionLabel: 'Recommended Action',
            actionText: obj.recommendedAction || '',
            actionBoxClass: 'action-box red-border',
            evidence: obj.evidence
        };
    }

    _mapPackSizeElasticity(obj) {
        if (!obj) return null;
        const body = `Demand ceiling: <strong>${obj.demandCeiling || 'N/A'}</strong>.<br><br>Recommended next cycle: <strong>${obj.recommendedRangeNextCycle || 'N/A'}</strong>.`;
        return {
            title: 'Pack Size Elasticity',
            signalLabel: obj.signalDetected === 'Yes' ? 'Signal Detected' : null,
            signalPillClass: this._signalPillClass(obj.signalDetected === 'Yes' ? 'yes' : 'no'),
            body,
            actionLabel: 'Justification',
            actionText: obj.justification || '',
            actionBoxClass: 'action-box'
        };
    }

    _mapUpsellOpportunity(obj) {
        if (!obj) return null;
        const body = `DSR proposed <strong>${obj.variantSignal || 'N/A'}</strong>. Cluster opportunity: <strong>${obj.clusterOpportunity || 'N/A'}</strong>.`;
        return {
            title: 'Upsell Opportunity',
            signalLabel: obj.signalDetected === 'Yes' ? 'Signal Detected' : null,
            signalPillClass: this._signalPillClass(obj.signalDetected === 'Yes' ? 'yes' : 'no'),
            body,
            actionLabel: 'Justification',
            actionText: obj.justification || '',
            actionBoxClass: 'action-box green-border'
        };
    }

    _mapCompetitiveDiscountPressure(obj) {
        if (!obj) return null;
        return {
            title: 'Competitive Discount Pressure',
            severity: obj.severity,
            severityClass: this._severityClass(obj.severity),
            body: obj.justification || '',
            actionLabel: 'Risk',
            actionText: obj.justification || '',
            actionBoxClass: 'action-box red-border'
        };
    }

    _mapMarginSensitivityFlag(obj) {
        if (!obj) return null;
        const infoRows = [
            { rowId: 'ms-0', key: 'Margin Sensitive Outlet', value: obj.marginSensitiveOutlet || 'N/A', valueClass: obj.marginSensitiveOutlet === 'Yes' ? 'badge badge-red' : 'badge badge-green' },
            { rowId: 'ms-1', key: 'Loyalty Risk Score', value: obj.loyaltyRiskScore || 'N/A', valueClass: 'severity-tag sev-mod' }
        ];
        return {
            title: 'Margin Sensitivity Flag',
            severity: obj.loyaltyRiskScore,
            severityClass: this._severityClass(obj.loyaltyRiskScore),
            body: obj.justification || '',
            infoRows
        };
    }

    _mapCategoryMovementSignal(obj) {
        if (!obj) return null;
        return {
            title: 'Category Movement Signal',
            signalLabel: obj.slowMovementDetected === 'Yes' ? 'Slow Movement' : 'No Signal',
            signalPillClass: this._signalPillClass(obj.slowMovementDetected === 'Yes' ? 'yes' : 'no'),
            body: obj.justification || '',
            actionLabel: 'Dispatch Recommendation',
            actionText: obj.recommendedDispatchAction || '',
            actionBoxClass: 'action-box red-border'
        };
    }

    _mapCreditBehaviorPattern(obj) {
        if (!obj) return null;
        const infoRows = [
            { rowId: 'cb-0', key: 'Cash Flow Pressure Signal', value: obj.cashFlowPressureSignal || 'N/A', valueClass: obj.cashFlowPressureSignal === 'No' ? 'badge badge-green' : 'badge badge-red' },
            { rowId: 'cb-1', key: 'Risk Segmentation Flag', value: obj.riskSegmentationFlag || 'N/A', valueClass: obj.riskSegmentationFlag === 'No' ? 'badge badge-green' : 'badge badge-amber' },
            { rowId: 'cb-2', key: 'Justification', value: obj.justification || '', valueClass: 'info-val' }
        ];
        return {
            title: 'Credit Behavior Pattern',
            signalLabel: obj.cashFlowPressureSignal === 'No' ? 'No Pressure' : 'Pressure',
            signalPillClass: this._signalPillClass(obj.cashFlowPressureSignal === 'No' ? 'no' : 'yes'),
            body: obj.justification || '',
            actionBoxClass: 'action-box green-border',
            infoRows
        };
    }

    _severityClass(severity) {
        const s = (severity || '').toLowerCase();
        if (s.includes('high')) return 'severity-tag sev-high';
        if (s.includes('mod')) return 'severity-tag sev-mod';
        return 'severity-tag sev-low';
    }

    _signalPillClass(type) {
        const map = { yes: 'signal-pill pill-yes', no: 'signal-pill pill-no', mod: 'signal-pill pill-mod' };
        return map[type] || 'signal-pill pill-mod';
    }

    handleTabClick(event) {
        this.currentTab = event.currentTarget.dataset.tab;
    }

    get summaryPanelClass() { return this.currentTab === 'summary' ? 'tab-panel active' : 'tab-panel'; }
    get salesPanelClass() { return this.currentTab === 'sales' ? 'tab-panel active' : 'tab-panel'; }
    get tradePanelClass() { return this.currentTab === 'trade' ? 'tab-panel active' : 'tab-panel'; }
    get supplyPanelClass() { return this.currentTab === 'supply' ? 'tab-panel active' : 'tab-panel'; }
    get dsrPanelClass() { return this.currentTab === 'dsr' ? 'tab-panel active' : 'tab-panel'; }
    get summaryTabClass() { return this.currentTab === 'summary' ? 'tab-btn active' : 'tab-btn'; }
    get salesTabClass() { return this.currentTab === 'sales' ? 'tab-btn active' : 'tab-btn'; }
    get tradeTabClass() { return this.currentTab === 'trade' ? 'tab-btn active' : 'tab-btn'; }
    get supplyTabClass() { return this.currentTab === 'supply' ? 'tab-btn active' : 'tab-btn'; }
    get dsrTabClass() { return this.currentTab === 'dsr' ? 'tab-btn active' : 'tab-btn'; }
    get competitiveSeverityClass() { return this._severityClass(this.competitiveSignal.severity); }
    get hasData() { return this.reportData && !this.error; }
}