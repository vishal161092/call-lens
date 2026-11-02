import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getMasterAudit from '@salesforce/apex/MasterCallAuditController.getMasterAudit';
import getCallAnalysis from '@salesforce/apex/MasterCallAuditController.getCallAnalysis';
import getCallMedia from '@salesforce/apex/MasterCallAuditController.getCallMedia';
import getGenericKpiQuestions from '@salesforce/apex/MasterCallAuditController.getGenericKpiQuestions';
import getAgentRubric from '@salesforce/apex/MasterCallAuditController.getAgentRubric';

// The master path scores natively on a 1–5 scale (see MasterCallAuditController).
const MASTER_SCALE_MAX = 5;
// Friendly labels for the Lead_Type__c short codes actually stored in the org.
const LEAD_TYPE_LABELS = {
    FIS: '🏬 FIS — Find in Store',
    AddtoCart: '🛒 Cart Adders',
    Bridal: '💍 Bridal — Wedding',
    Wishlist: '❤️ Website Wishlist',
    Unspecified: '❔ Unspecified'
};
// Icon + plain-text split for the redesigned Overview lead-type table.
const LEAD_TYPE_ICONS = {
    FIS: '🏪',
    AddtoCart: '🛒',
    Bridal: '💍',
    Wishlist: '❤️',
    Unspecified: '❓'
};
const LEAD_TYPE_PLAIN = {
    FIS: 'FIS — Find in Store',
    AddtoCart: 'Cart Adders',
    Bridal: 'Bridal — Wedding',
    Wishlist: 'Website Wishlist',
    Unspecified: 'Unspecified'
};
const METRIC_LABELS = {
    tone: 'Tone',
    compliance: 'Compliance',
    empathy: 'Empathy',
    resolutionQuality: 'Resolution Quality',
    brandAdherence: 'Brand Adherence',
    mandatoryDisclosures: 'Mandatory Disclosures'
};

export default class DeLeadSelectorV2 extends NavigationMixin(LightningElement) {
    @track error;
    @track activeScreen = 'admin'; // landing tab = Overview

    /* ============================================================ */
    /*  MASTER call-audit view (Apex aggregation — no LLM).          */
    /*  Overview tiles + Date → Lead Type → Agent → record → call    */
    /*  drill-down, all fed by MasterCallAuditController.             */
    /* ============================================================ */
    @track masterData = null;
    @track masterLoading = false;
    @track masterError = null;
    @track filterStartDate = null;
    @track filterEndDate = null;
    // Master drill-down: 'leadType' (L1) → 'agent' (L2) → 'record' (L3) → 'call' (L4)
    @track masterDrillView = 'leadType';
    @track masterLeadTypeKey = null;
    @track masterAgentKey = null;
    @track masterCallId = null;
    // Full per-call JSON fetched on demand for the L4 analysis view.
    @track masterCallDetail = null;
    @track masterCallDetailLoading = false;
    // Call recording + transcript (real: MP3 ContentVersion + Audio_Transcription__c).
    @track masterCallMedia = null;
    // My Team drill-down (Apex-driven): 'agents' (leaderboard) → 'agent' (high-level) → 'call'
    @track teamDrillView = 'agents';
    @track teamAgentKey = null;
    // Scorecard drill (Apex-driven): null (agent picker) → agent key (single-agent scorecard)
    @track scorecardAgentKey = null;
    // Per-agent rubric compliance (My Team → agent view), fetched on agent select.
    @track agentRubric = null;
    @track agentRubricLoading = false;

    // Coaching feed: which theme groups are collapsed (set of theme keys).
    @track collapsedCoach = {};
    @track collapsedKpi = {};
    // Generic ("Common") KPI question texts from the CMDT — used to split the
    // call's KPI evaluations into a type-specific bucket vs a generic sub-bucket.
    genericKpiSet = null;

    connectedCallback() {
        this.loadMasterAudit();
        getGenericKpiQuestions()
            .then((qs) => {
                this.genericKpiSet = new Set((qs || []).map((q) => (q || '').trim().toLowerCase()));
            })
            .catch(() => { this.genericKpiSet = new Set(); });
    }

    /* ============================================================ */
    /*  Master data loading + date filter                            */
    /* ============================================================ */
    loadMasterAudit() {
        this.masterLoading = true;
        this.masterError = null;
        getMasterAudit({
            startDate: this.filterStartDate || null,
            endDate: this.filterEndDate || null,
            leadType: null,
            agentName: null
        })
            .then((result) => {
                this.masterData = result;
                this.masterLoading = false;
            })
            .catch((error) => {
                this.masterError = this.extractError(error, 'Failed to load master audit');
                this.masterData = null;
                this.masterLoading = false;
                console.error('Error loading master audit:', error);
            });
    }

    handleStartDateChange(event) {
        this.filterStartDate = event.target.value || null;
    }

    handleEndDateChange(event) {
        this.filterEndDate = event.target.value || null;
    }

    handleApplyDateFilter() {
        this.resetMasterDrill();
        this.loadMasterAudit();
    }

    handleClearDateFilter() {
        this.filterStartDate = null;
        this.filterEndDate = null;
        this.resetMasterDrill();
        this.loadMasterAudit();
    }

    // Reset the drill-down to the top level (used when the result set changes).
    resetMasterDrill() {
        this.masterDrillView = 'leadType';
        this.masterLeadTypeKey = null;
        this.masterAgentKey = null;
        this.masterCallId = null;
        this.masterCallDetail = null;
        this.teamDrillView = 'agents';
        this.teamAgentKey = null;
        this.scorecardAgentKey = null;
    }

    extractError(error, fallback) {
        if (error && error.body) {
            if (typeof error.body === 'string') { return error.body; }
            if (error.body.message) { return error.body.message; }
        } else if (error && error.message) {
            return error.message;
        }
        return fallback;
    }

    /* ============================================================ */
    /*  Master Overview — tiles fed by MasterCallAuditController      */
    /* ============================================================ */
    get hasMasterData() {
        return !!(this.masterData && this.masterCalls.length);
    }

    get masterCalls() {
        return (this.masterData && this.masterData.calls) || [];
    }

    get masterSummary() {
        return (this.masterData && this.masterData.summary) || {};
    }

    get masterTotalCalls() { return this.masterSummary.totalCalls || 0; }
    get masterFatalCount() { return this.masterSummary.fatalCount || 0; }

    get masterAvgDisplay() {
        const avg = Number(this.masterSummary.averageOverallScore) || 0;
        const band = this.scoreBand(avg);
        return {
            value: avg.toFixed(2),
            max: MASTER_SCALE_MAX,
            percent: Math.round((avg / MASTER_SCALE_MAX) * 100),
            bandLabel: band.label,
            colorClass: band.scoreClass
        };
    }

    // Avg-score stat value coloured by band.
    get masterAvgValClass() {
        const band = this.scoreBand(Number(this.masterSummary.averageOverallScore) || 0);
        return `mca-stat-val ${band.scoreClass}`;
    }

    // Fatal-count stat: green when clean, red when any flagged.
    get masterFatalValClass() {
        return this.masterFatalCount > 0 ? 'mca-stat-val score-red' : 'mca-stat-val score-green';
    }

    get masterFatalSubText() {
        return this.masterFatalCount > 0
            ? `${this.masterFatalCount} flagged across analysed calls`
            : 'Clean · No flags across all calls';
    }

    // Shared 1–5 → colour band mapping for the redesigned Overview.
    // Returns hex, a short label, and the matching `score-*`/`tag-*`/`badge-*` class stems.
    scoreBand(score) {
        const s = Number(score) || 0;
        if (s >= 4.5) return { color: '#16A34A', label: 'Exceptional', scoreClass: 'score-green', tagClass: 'tag-green', badgeClass: 'badge-green' };
        if (s >= 4.0) return { color: '#16A34A', label: 'Excellent', scoreClass: 'score-green', tagClass: 'tag-green', badgeClass: 'badge-green' };
        if (s >= 3.5) return { color: '#2563EB', label: 'Good', scoreClass: 'score-blue', tagClass: 'tag-blue', badgeClass: 'badge-blue' };
        if (s >= 3.0) return { color: '#D97706', label: 'Fair', scoreClass: 'score-amber', tagClass: 'tag-amber', badgeClass: 'badge-amber' };
        if (s >= 2.0) return { color: '#EA580C', label: 'Low', scoreClass: 'score-orange', tagClass: 'tag-orange', badgeClass: 'badge-red' };
        return { color: '#DC2626', label: 'Needs Work', scoreClass: 'score-red', tagClass: 'tag-red', badgeClass: 'badge-red' };
    }

    get masterSentiment() {
        const mix = this.masterSummary.sentimentMix || {};
        const pos = mix.Positive || 0;
        const neu = mix.Neutral || 0;
        const neg = mix.Negative || 0;
        const total = pos + neu + neg || 1;
        const posPct = Math.round((pos / total) * 100);
        const neuPct = Math.round((neu / total) * 100);
        const negPct = Math.round((neg / total) * 100);
        return {
            positive: pos,
            neutral: neu,
            negative: neg,
            positivePct: posPct,
            neutralPct: neuPct,
            negativePct: negPct,
            posBarStyle: `width:${posPct}%`,
            neuBarStyle: `width:${neuPct}%`,
            negBarStyle: `width:${negPct}%`
        };
    }

    // Sentiment mix donut (positive / neutral / negative) — three arcs over one ring.
    get masterSentimentDonut() {
        const s = this.masterSentiment;
        const circ = 175.9; // 2πr, r=28
        const posLen = (s.positivePct / 100) * circ;
        const neuLen = (s.neutralPct / 100) * circ;
        const negLen = (s.negativePct / 100) * circ;
        return {
            positivePct: s.positivePct,
            neutralPct: s.neutralPct,
            negativePct: s.negativePct,
            posStyle: `stroke:#16A34A;stroke-dasharray:${posLen.toFixed(1)} ${circ};stroke-dashoffset:0;`,
            neuStyle: `stroke:#94A3B8;stroke-dasharray:${neuLen.toFixed(1)} ${circ};stroke-dashoffset:${(-posLen).toFixed(1)};`,
            negStyle: `stroke:#DC2626;stroke-dasharray:${negLen.toFixed(1)} ${circ};stroke-dashoffset:${(-(posLen + neuLen)).toFixed(1)};`
        };
    }

    // Journey mix & quality by journey — one row per lead type: share of total
    // calls, avg score, and fatal count. All real aggregates.
    get masterJourneyMix() {
        const total = this.masterTotalCalls || 0;
        const palette = ['#2563EB', '#7C3AED', '#16A34A', '#D97706', '#EA580C', '#DC2626'];
        return this.masterLeadTypeGroups.map((g, i) => {
            const pct = total ? Math.round((g.count / total) * 100) : 0;
            const color = palette[i % palette.length];
            return {
                key: g.key,
                icon: g.icon,
                label: g.plainLabel,
                pct: `${pct}%`,
                barStyle: `width:${pct}%;background:${color};`,
                dotStyle: `background:${color};`,
                count: g.count,
                avgDisplay: g.avgDisplay,
                fatalCount: g.hasFatal ? g.fatalLabel : 'No fatal errors',
                metaLine: `${g.count} audits · avg ${g.avgDisplay}`
            };
        });
    }

    get hasMasterJourneyMix() { return this.masterJourneyMix.length > 0; }

    // Distinct lead types present in the current result set (for KPI subtitle).
    get masterLeadTypeCount() {
        const seen = new Set();
        this.masterCalls.forEach((c) => seen.add(c.leadType || 'Unspecified'));
        const n = seen.size;
        return `${n} lead type${n === 1 ? '' : 's'}`;
    }

    // Score-by-parameter bars (org-wide averages) — 4-band colour for the redesigned Overview.
    get masterParameterRows() {
        const sbp = (this.masterData && this.masterData.scoreByParameter) || {};
        return Object.keys(sbp).map((key) => {
            const val = Number(sbp[key]) || 0;
            const pct = (val / MASTER_SCALE_MAX) * 100;
            let color = '#EA580C'; let scoreClass = 'score-orange'; let tagClass = 'tag-orange'; let tagLabel = 'Low';
            if (val >= 4.0) { color = '#16A34A'; scoreClass = 'score-green'; tagClass = 'tag-green'; tagLabel = 'Strong'; }
            else if (val >= 3.5) { color = '#2563EB'; scoreClass = 'score-blue'; tagClass = 'tag-blue'; tagLabel = 'Good'; }
            else if (val >= 3.0) { color = '#D97706'; scoreClass = 'score-amber'; tagClass = 'tag-amber'; tagLabel = 'Fair'; }
            return {
                key,
                label: METRIC_LABELS[key] || this.formatMetricLabel(key),
                value: val.toFixed(2),
                valueDisplay: `${val.toFixed(2)} / ${MASTER_SCALE_MAX}`,
                barStyle: `width:${pct.toFixed(1)}%;background:${color};`,
                qbarScoreClass: `mca-qbar-score ${scoreClass}`,
                qbarTagClass: `mca-qbar-tag ${tagClass}`,
                tagLabel,
                needsAttention: val < 3.0
            };
        });
    }

    get hasMasterParameterRows() { return this.masterParameterRows.length > 0; }

    // Parameters scoring below 3.0 — surfaces the coaching callout under the chart.
    get masterWeakParameters() {
        return this.masterParameterRows.filter((p) => p.needsAttention);
    }

    get hasMasterWeakParameters() { return this.masterWeakParameters.length > 0; }

    get masterWeakParametersLabel() {
        const names = this.masterWeakParameters.map((p) => p.label);
        if (!names.length) { return ''; }
        const joined = names.length === 1
            ? names[0]
            : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        return `${joined} scored below 3.0 — consider targeted coaching`;
    }

    // Score distribution rows
    get masterDistItems() {
        const d = this.masterSummary.scoreDistribution || {};
        const total = this.masterTotalCalls || 1;
        const defs = [
            { key: 'exceptional', label: 'Exceptional (4.5+)', color: '#059669', dot: '#6EE7B7' },
            { key: 'excellent', label: 'Excellent (4.0–4.4)', color: '#16A34A', dot: '#16A34A' },
            { key: 'good', label: 'Good (3.0–3.9)', color: '#D97706', dot: '#D97706' },
            { key: 'fair', label: 'Fair (2.0–2.9)', color: '#EA580C', dot: '#EA580C' },
            { key: 'needsImprovement', label: 'Needs Improvement (<2.0)', color: '#DC2626', dot: '#DC2626' }
        ];
        return defs.map((def) => {
            const count = d[def.key] || 0;
            const pct = (count / total) * 100;
            return {
                key: def.key,
                label: def.label,
                count,
                pctDisplay: `${pct.toFixed(1)}%`,
                distCountClass: count > 0 ? `mca-dist-count ${this.distScoreClass(def.key)}` : 'mca-dist-count mca-muted-count',
                barStyle: `width:${pct.toFixed(1)}%;background:${def.color};`,
                dotStyle: `background:${def.dot};`
            };
        });
    }

    // Stacked segmented distribution bar + inline legend + coaching insight.
    // Only non-empty bands become segments; the widest segment shows "count · pct".
    get masterDistStacked() {
        const d = this.masterSummary.scoreDistribution || {};
        const total = this.masterTotalCalls || 0;
        const defs = [
            { key: 'exceptional', label: 'Exceptional', short: 'Exceptional', color: '#059669' },
            { key: 'excellent', label: 'Excellent', short: 'Excellent+', color: '#16A34A' },
            { key: 'good', label: 'Good', short: 'Good', color: '#D97706' },
            { key: 'fair', label: 'Fair', short: 'Fair', color: '#EA580C' },
            { key: 'needsImprovement', label: 'Needs Work', short: 'Needs Work', color: '#DC2626' }
        ];
        const rows = defs.map((def) => {
            const count = d[def.key] || 0;
            const pct = total ? (count / total) * 100 : 0;
            return { ...def, count, pct };
        });
        // widest band → used for the callout and the in-bar "count · pct" label
        let top = rows[0];
        rows.forEach((r) => { if (r.count > top.count) top = r; });

        const segments = rows
            .filter((r) => r.count > 0)
            .map((r) => ({
                key: r.key,
                segStyle: `width:${r.pct.toFixed(2)}%;background:${r.color};`,
                showFull: r.pct >= 18,          // enough room for "count · pct"
                fullLabel: `${r.count} · ${r.pct.toFixed(1)}%`,
                count: r.count
            }));

        const legend = rows
            .filter((r) => r.count > 0)
            .map((r) => ({
                key: r.key,
                dotStyle: `background:${r.color};`,
                label: r.short,
                count: r.count,
                pctDisplay: `${r.pct.toFixed(1)}%`,
                countClass: `mca-diststk-lg-n ${this.distScoreClass(r.key)}`
            }));

        // Coaching insight tail tailored to the dominant band.
        const tails = {
            exceptional: 'outstanding — capture what these agents do and share it as best practice.',
            excellent: 'strong performance — reinforce it and lift the rest of the team to match.',
            good: 'focus coaching on moving them into the Excellent range.',
            fair: 'prioritise coaching here to pull scores back into a healthy range.',
            needsImprovement: 'urgent coaching focus — these calls need immediate attention.'
        };
        return {
            segments,
            legend,
            insightPct: total ? `${top.pct.toFixed(1)}%` : '0%',
            insightBand: top.label,
            insightTail: tails[top.key] || '',
            insightStyle: `background:${this.hexToTint(top.color)};border-color:${this.hexToTint(top.color, 0.35)};`,
            insightAccent: `color:${top.color};`
        };
    }

    // Light translucent tint of a hex colour for callout backgrounds.
    hexToTint(hex, alpha = 0.1) {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    distScoreClass(key) {
        switch (key) {
            case 'exceptional':
            case 'excellent': return 'score-green';
            case 'good': return 'score-amber';
            case 'fair': return 'score-orange';
            default: return 'score-red';
        }
    }

    // Donut summary for the distribution card: dominant band + condensed counts.
    get masterDistSummary() {
        const d = this.masterSummary.scoreDistribution || {};
        const total = this.masterTotalCalls || 0;
        const excellentPlus = (d.exceptional || 0) + (d.excellent || 0);
        const good = d.good || 0;
        const fair = d.fair || 0;
        const needsWork = d.needsImprovement || 0;
        // Dominant band drives the donut ring.
        const bands = [
            { label: 'Excellent+', count: excellentPlus, color: '#16A34A' },
            { label: 'Good', count: good, color: '#D97706' },
            { label: 'Fair', count: fair, color: '#EA580C' },
            { label: 'Needs Work', count: needsWork, color: '#DC2626' }
        ];
        let top = bands[0];
        bands.forEach((b) => { if (b.count > top.count) top = b; });
        const pct = total ? Math.round((top.count / total) * 100) : 0;
        const circumference = 175.9; // 2πr, r=28
        const filled = total ? (top.count / total) * circumference : 0;
        return {
            topLabel: top.label,
            topPct: `${pct}%`,
            ringColor: top.color,
            ringStyle: `stroke:${top.color};stroke-dasharray:${filled.toFixed(1)} ${circumference};`,
            excellentPlus,
            good,
            fair,
            needsWork
        };
    }

    /* ============================================================ */
    /*  Overview — premium hero banner (mirrors the individual        */
    /*  component's dark score panel). All values from real data.     */
    /* ============================================================ */
    get masterHero() {
        const avg = Number(this.masterSummary.averageOverallScore) || 0;
        const band = this.scoreBand(avg);
        // Inline mini score-bars for the six parameters (reuse the computed rows).
        const rows = this.masterParameterRows.map((p) => ({
            key: p.key,
            label: p.label,
            value: p.value,
            // fill % of the 1–5 scale; colour comes from the same band mapping
            barStyle: `width:${Math.round((Number(p.value) / MASTER_SCALE_MAX) * 100)}%;background:${this.scoreBand(Number(p.value)).color};`
        }));
        // Overall-score donut geometry (r=32 → circumference ≈ 201.06).
        const circumference = 201.06;
        const filled = (avg / MASTER_SCALE_MAX) * circumference;
        return {
            avg: avg.toFixed(2),
            max: MASTER_SCALE_MAX,
            bandLabel: band.label,
            ringColor: band.color,
            ringStyle: `stroke:${band.color};stroke-dasharray:${filled.toFixed(1)} ${circumference};`,
            pillStyle: `background:${band.color};`,
            rows
        };
    }

    // Business Insights hero — SAME layout idea as the Overview hero, but
    // filled with insights-relevant signals: sentiment mix (mid) + positive
    // sentiment donut (right). No agent-quality KPIs (those live on Overview).
    get insightsHero() {
        const s = this.masterSentiment;
        const rows = [
            { key: 'pos', label: '😊 Positive', value: `${s.positivePct}%`, barStyle: `width:${s.positivePct}%;background:#16A34A;` },
            { key: 'neu', label: '😐 Neutral', value: `${s.neutralPct}%`, barStyle: `width:${s.neutralPct}%;background:#D97706;` },
            { key: 'neg', label: '😟 Negative', value: `${s.negativePct}%`, barStyle: `width:${s.negativePct}%;background:#DC2626;` }
        ];
        // Donut = positive-sentiment share of all analysed calls (0–100%).
        const circumference = 201.06;
        const filled = (s.positivePct / 100) * circumference;
        let color = '#DC2626';
        let bandLabel = 'Low';
        if (s.positivePct >= 60) { color = '#16A34A'; bandLabel = 'Healthy'; }
        else if (s.positivePct >= 40) { color = '#2563EB'; bandLabel = 'Steady'; }
        else if (s.positivePct >= 25) { color = '#D97706'; bandLabel = 'Watch'; }
        return {
            rows,
            donutVal: `${s.positivePct}%`,
            donutSub: `${s.positive} of ${s.positive + s.neutral + s.negative}`,
            bandLabel,
            ringStyle: `stroke:${color};stroke-dasharray:${filled.toFixed(1)} ${circumference};`,
            pillStyle: `background:${color};`
        };
    }

    /* ============================================================ */
    /*  Overview — extra panels (all from real CallRow data)         */
    /* ============================================================ */

    // Top customer intents (aiInsights.intentCategory buckets). Bars are
    // scaled against the most common intent so the leader is full-width.
    get masterIntentRows() {
        const counts = {};
        this.masterCalls.forEach((c) => {
            if (c.intentCategory) {
                counts[c.intentCategory] = (counts[c.intentCategory] || 0) + 1;
            }
        });
        const keys = Object.keys(counts);
        if (!keys.length) { return []; }
        const max = Math.max(...keys.map((k) => counts[k]));
        return keys
            .map((k) => {
                const count = counts[k];
                const pct = max ? (count / max) * 100 : 0;
                return {
                    key: k,
                    label: k,
                    count,
                    barStyle: `width:${pct.toFixed(1)}%`,
                    _sort: count
                };
            })
            .sort((a, b) => b._sort - a._sort)
            .slice(0, 6);
    }

    get hasMasterIntents() { return this.masterIntentRows.length > 0; }

    // Fatal interactions grouped by reason (fatalError.reason). Empty when the
    // data has no flagged calls — the card then shows a clean-state message.
    get masterFatalRows() {
        const counts = {};
        this.masterCalls.forEach((c) => {
            if (c.isFatal) {
                const reason = c.fatalReason || 'Unspecified reason';
                counts[reason] = (counts[reason] || 0) + 1;
            }
        });
        const keys = Object.keys(counts);
        if (!keys.length) { return []; }
        const max = Math.max(...keys.map((k) => counts[k]));
        // Deepen the red as the count rises so the worst reason reads darkest.
        const shades = ['#991B1B', '#B91C1C', '#DC2626', '#EA580C', '#F97316'];
        return keys
            .map((k) => ({ key: k, label: k, count: counts[k], _sort: counts[k] }))
            .sort((a, b) => b._sort - a._sort)
            .map((row, i) => {
                const pct = max ? (row.count / max) * 100 : 0;
                const color = shades[Math.min(i, shades.length - 1)];
                return {
                    ...row,
                    barStyle: `width:${pct.toFixed(1)}%;background:${color};`,
                    countClass: `mca-fbar-n`,
                    countStyle: `color:${color};`
                };
            });
    }

    get hasMasterFatalRows() { return this.masterFatalRows.length > 0; }

    get masterFatalTotalLabel() {
        const n = this.masterFatalCount;
        return `${n} fatal instance${n === 1 ? '' : 's'}`;
    }

    // Quality & fatal trend by day (from Call_Date__c, falling back to CreatedDate).
    // Produces an SVG polyline for the avg score and light bars for the fatal count.
    get masterTrend() {
        const byDay = {};
        this.masterCalls.forEach((c) => {
            const when = c.callDate || c.createdDate;
            if (!when) { return; }
            const day = new Date(when).toISOString().slice(0, 10);
            if (!byDay[day]) { byDay[day] = { day, scoreSum: 0, analyzable: 0, fatal: 0 }; }
            const b = byDay[day];
            if (c.analyzable) { b.scoreSum += Number(c.overallScore) || 0; b.analyzable++; }
            if (c.isFatal) { b.fatal++; }
        });
        const days = Object.keys(byDay).sort();
        if (days.length < 2) {
            return { hasTrend: false, points: [], areaPath: '', bars: [], xLabels: [], maxFatal: 0 };
        }

        // Chart geometry (matches the SVG viewBox 0 0 820 200).
        const x0 = 50; const x1 = 800; const yTop = 20; const yBot = 170;
        const span = days.length > 1 ? (x1 - x0) / (days.length - 1) : 0;
        // Score axis fixed to the native 1–5 scale so the line is comparable over time.
        const scoreToY = (s) => yBot - ((s - 1) / (MASTER_SCALE_MAX - 1)) * (yBot - yTop);
        const maxFatal = Math.max(1, ...days.map((d) => byDay[d].fatal));

        const points = days.map((d, i) => {
            const b = byDay[d];
            const avg = b.analyzable ? b.scoreSum / b.analyzable : 0;
            const x = x0 + span * i;
            const y = scoreToY(avg);
            return { key: d, x: x.toFixed(1), y: y.toFixed(1), avg: avg.toFixed(2) };
        });

        const polyPoints = points.map((p) => `${p.x},${p.y}`).join(' ');
        const areaPath = `M${points[0].x},${points[0].y} `
            + points.slice(1).map((p) => `L${p.x},${p.y}`).join(' ')
            + ` L${points[points.length - 1].x},${yBot} L${points[0].x},${yBot} Z`;

        const barW = Math.max(4, Math.min(28, span * 0.55));
        const bars = days.map((d, i) => {
            const b = byDay[d];
            const h = (b.fatal / maxFatal) * (yBot - yTop) * 0.5;
            const x = x0 + span * i - barW / 2;
            return {
                key: `bar-${d}`,
                x: x.toFixed(1),
                y: (yBot - h).toFixed(1),
                w: barW.toFixed(1),
                h: h.toFixed(1),
                fatal: b.fatal
            };
        });

        // X labels: first, middle, last (avoid clutter).
        const idxs = [0, Math.floor((days.length - 1) / 2), days.length - 1];
        const xLabels = [...new Set(idxs)].map((i) => ({
            key: `xl-${i}`,
            x: (x0 + span * i).toFixed(1),
            label: this.shortDate(days[i])
        }));

        return { hasTrend: true, points, polyPoints, areaPath, bars, xLabels, maxFatal };
    }

    get hasMasterTrend() { return this.masterTrend.hasTrend; }

    shortDate(iso) {
        // iso is YYYY-MM-DD → "Aug 12"
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const parts = String(iso).split('-');
        if (parts.length !== 3) { return iso; }
        return `${months[Number(parts[1]) - 1]} ${Number(parts[2])}`;
    }

    // Coaching themes for the Overview — derived from the weakest-parameter
    // distribution (real signal), not hand-written copy. Top three weak spots.
    get masterCoachingThemes() {
        const dist = this.insightsWeakestDist; // reuse the real computation
        if (!dist.length) { return []; }
        const palette = ['amber', 'blue', 'green'];
        return dist.slice(0, 3).map((w, i) => ({
            key: `theme-${w.key}`,
            themeClass: `ctheme ${palette[i] || 'blue'}`,
            title: `${w.label} is the weakest parameter most often`,
            desc: `Lowest-scoring dimension in ${w.countLabel} — a focused coaching target.`
        }));
    }

    get hasMasterCoachingThemes() { return this.masterCoachingThemes.length > 0; }

    get masterFilterLabel() {
        if (this.filterStartDate && this.filterEndDate) {
            return `${this.filterStartDate} → ${this.filterEndDate}`;
        }
        if (this.filterStartDate) { return `From ${this.filterStartDate}`; }
        if (this.filterEndDate) { return `Until ${this.filterEndDate}`; }
        return 'All time';
    }

    get masterSubtitle() {
        const n = this.masterTotalCalls;
        return `${n} call${n === 1 ? '' : 's'} analysed · ${this.masterFilterLabel}`;
    }

    /* ============================================================ */
    /*  Master drill-down: Lead Type → Agent → record → call         */
    /*  (all computed from masterCalls so filters nest correctly)     */
    /* ============================================================ */
    get isMasterLeadTypeList() { return this.isAdmin && this.masterDrillView === 'leadType'; }
    get isMasterAgentList() { return this.isAdmin && this.masterDrillView === 'agent'; }
    get isMasterRecordList() { return this.isAdmin && this.masterDrillView === 'record'; }
    get isMasterCallView() { return this.isAdmin && this.masterDrillView === 'call'; }

    decorateGroup(g, label) {
        const avg = g.analyzable ? g.scoreSum / g.analyzable : 0;
        const pct = Math.round((avg / MASTER_SCALE_MAX) * 100);
        let statusClass = 'badge badge-error';
        if (avg >= 3) statusClass = 'badge badge-success';
        else if (avg >= 2) statusClass = 'badge badge-warning';
        const band = this.scoreBand(avg);
        return {
            key: g.key,
            label,
            count: g.count,
            callsLabel: `${g.count} call${g.count === 1 ? '' : 's'}`,
            avgDisplay: `${avg.toFixed(2)} / ${MASTER_SCALE_MAX}`,
            scoreBadgeClass: `score-badge ${band.badgeClass}`,
            avgPercent: `${pct}%`,
            fatalLabel: g.fatal > 0 ? `${g.fatal} fatal` : 'No fatal errors',
            hasFatal: g.fatal > 0,
            statusClass
        };
    }

    accumulate(target, call) {
        target.count++;
        if (call.isFatal) { target.fatal++; }
        if (call.analyzable) {
            target.analyzable++;
            target.scoreSum += Number(call.overallScore) || 0;
        }
    }

    // L1: group all calls by Lead Type
    get masterLeadTypeGroups() {
        const groups = {};
        this.masterCalls.forEach((c) => {
            const key = c.leadType || 'Unspecified';
            if (!groups[key]) { groups[key] = { key, count: 0, scoreSum: 0, analyzable: 0, fatal: 0 }; }
            this.accumulate(groups[key], c);
        });
        return Object.values(groups)
            .map((g) => ({
                ...this.decorateGroup(g, LEAD_TYPE_LABELS[g.key] || g.key),
                icon: LEAD_TYPE_ICONS[g.key] || '📞',
                plainLabel: LEAD_TYPE_PLAIN[g.key] || g.key,
                isUnspecified: g.key === 'Unspecified'
            }))
            .sort((a, b) => b.count - a.count);
    }

    get masterSelectedLeadTypeLabel() {
        return LEAD_TYPE_LABELS[this.masterLeadTypeKey] || this.masterLeadTypeKey || '';
    }

    // L2: agents within the selected Lead Type
    get masterAgentGroups() {
        const groups = {};
        this.masterCalls
            .filter((c) => (c.leadType || 'Unspecified') === this.masterLeadTypeKey)
            .forEach((c) => {
                const key = c.agentName || 'Unassigned';
                if (!groups[key]) { groups[key] = { key, count: 0, scoreSum: 0, analyzable: 0, fatal: 0 }; }
                this.accumulate(groups[key], c);
            });
        return Object.values(groups)
            .map((g) => ({ ...this.decorateGroup(g, g.key), initials: this.initialsOf(g.key) }))
            .sort((a, b) => b.count - a.count);
    }

    get masterSelectedAgentName() { return this.masterAgentKey || ''; }

    // L3: individual call records for the selected Lead Type + Agent
    get masterRecordRows() {
        return this.masterCalls
            .filter((c) => (c.leadType || 'Unspecified') === this.masterLeadTypeKey
                && (c.agentName || 'Unassigned') === this.masterAgentKey)
            .map((c) => {
                const score = Number(c.overallScore) || 0;
                return {
                    leadId: c.leadId,
                    name: c.name,
                    scoreDisplay: `${score.toFixed(1)} / ${MASTER_SCALE_MAX}`,
                    statusLabel: c.statusLabel,
                    statusBadgeClass: this.masterStatusBadge(score),
                    sentiment: c.sentiment || 'Neutral',
                    isFatal: c.isFatal,
                    weakest: c.weakestParam ? (METRIC_LABELS[c.weakestParam] || c.weakestParam) : '—',
                    createdDate: c.createdDate
                };
            })
            .sort((a, b) => (b.createdDate || 0) - (a.createdDate || 0));
    }

    masterStatusBadge(score) {
        if (score >= 3) return 'badge badge-success';
        if (score >= 2) return 'badge badge-warning';
        return 'badge badge-error';
    }

    // L4: the selected call's thin aggregation row (used for the header)
    get masterSelectedRecord() {
        return this.masterCalls.find((c) => c.leadId === this.masterCallId) || null;
    }

    // L4: full per-call analysis, fetched on demand and reshaped for display
    get masterCallView() {
        const data = this.masterCallDetail;
        const rec = this.masterSelectedRecord;
        if (!data) { return null; }

        // Quality scores -> metric rows (0-5 native scale)
        const qs = data.qualityScores || {};
        const metricRows = Object.keys(qs).map((key) => {
            const score = Number(qs[key] && qs[key].score) || 0;
            const pct = Math.round((score / MASTER_SCALE_MAX) * 100);
            let color = '#ba0517';
            if (score >= 4) color = '#2e844a';
            else if (score >= 3) color = '#fe9339';
            return {
                key,
                label: METRIC_LABELS[key] || this.formatMetricLabel(key),
                value: score,
                justification: (qs[key] && qs[key].justification) || '',
                barStyle: `width:${pct}%;background:${color};`
            };
        });

        const ai = data.aiInsights || {};
        const kpis = Array.isArray(data.kpiEvaluations) ? data.kpiEvaluations : [];
        const kpiRows = kpis.map((kpi, index) => {
            const answer = kpi.answer || 'No';
            return {
                key: `mkpi-${index}`,
                question: kpi.kpiQuestion || '',
                answer,
                justification: kpi.justification || '',
                evidence: kpi.evidence || '',
                checkMark: this.getCheckMark(answer),
                checkMarkClass: this.getCheckMarkClass(answer),
                resultBadgeClass: this.getKpiBadgeClass(answer)
            };
        });

        const improvements = Array.isArray(ai.scopeOfImprovement)
            ? ai.scopeOfImprovement.map((text, i) => ({ key: `mimp-${i}`, num: i + 1, text }))
            : [];

        const score = rec ? Number(rec.overallScore) || 0 : 0;
        return {
            leadName: rec ? rec.name : '',
            leadTypeLabel: rec ? (LEAD_TYPE_LABELS[rec.leadType] || rec.leadType) : '',
            overallScore: score.toFixed(1),
            scoreMax: MASTER_SCALE_MAX,
            scorePercent: Math.round((score / MASTER_SCALE_MAX) * 100),
            statusLabel: rec ? rec.statusLabel : '',
            statusBadgeClass: this.masterStatusBadge(score),
            sentiment: ai.sentiment || (rec ? rec.sentiment : ''),
            customerIntent: ai.customerIntent || '',
            summary: ai.interactionSummary || '',
            metricRows,
            kpiRows,
            improvements,
            hasKpis: kpiRows.length > 0,
            hasImprovements: improvements.length > 0
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Rubric-style scorecard for the individual call (all REAL data):    */
    /*  the 6 quality parameters as a weighted table (each scored 1–5),    */
    /*  a weighted /100 total, and the real fatal-error flag.              */
    /* ------------------------------------------------------------------ */
    get callRubric() {
        const data = this.masterCallDetail;
        if (!data) { return null; }
        const qs = data.qualityScores || {};
        const keys = Object.keys(qs);
        if (!keys.length) { return null; }

        let earnedSum = 0;
        const weightPer = MASTER_SCALE_MAX; // each parameter is worth up to 5
        const rows = keys.map((key) => {
            const score = Number(qs[key] && qs[key].score) || 0;
            earnedSum += score;
            let earnedClass = 'mca-rub-earned score-red';
            if (score >= 4) earnedClass = 'mca-rub-earned score-green';
            else if (score >= 3) earnedClass = 'mca-rub-earned score-amber';
            return {
                key,
                label: METRIC_LABELS[key] || this.formatMetricLabel(key),
                justification: (qs[key] && qs[key].justification) || '',
                weight: weightPer,
                earned: score,
                earnedClass
            };
        });
        const weightTotal = keys.length * weightPer;
        const scaled = weightTotal ? Math.round((earnedSum / weightTotal) * 100) : 0;

        const ai = data.aiInsights || {};
        const fatal = ai.fatalError || {};
        return {
            rows,
            weightTotal,
            earnedTotal: earnedSum,
            scaled100: scaled,
            paramCount: keys.length,
            isFatal: fatal.isFatal === true,
            fatalReason: fatal.reason || ''
        };
    }

    // KPI evaluations split into two top-level buckets — the lead's journey-
    // specific KPIs (the "main" bucket) and the generic call-quality KPIs
    // (Common in the CMDT) — each keeping the Met / Partial / Missed / NA
    // verdict sub-groups as-is. Uses only real answers.
    get callKpiSections() {
        const view = this.masterCallView;
        if (!view || !view.kpiRows || !view.kpiRows.length) { return []; }
        const genSet = this.genericKpiSet;
        const typeRows = [];
        const genericRows = [];
        view.kpiRows.forEach((k) => {
            const q = (k.question || '').trim().toLowerCase();
            // Until the CMDT set loads, treat everything as type-specific.
            if (genSet && genSet.has(q)) { genericRows.push(k); }
            else { typeRows.push(k); }
        });

        const typeLabel = view.leadTypeLabel || 'Journey';
        const defs = [
            { key: 'type', title: `🎯 ${typeLabel} — journey KPIs`, rows: typeRows },
            { key: 'generic', title: '📋 Generic call-quality KPIs', rows: genericRows }
        ].filter((s) => s.rows.length > 0);

        return defs.map((s) => {
            const override = this.collapsedKpi[`sec-${s.key}`];
            // Default: keep BOTH main sections open (user expands/collapses as needed).
            const open = override ? override === 'open' : true;
            return {
                key: `sec-${s.key}`,
                title: s.title,
                count: s.rows.length,
                open,
                caret: open ? '⌄' : '›',
                bodyClass: open ? 'mca-kpisec-body' : 'mca-kpisec-body mca-kpigrp-collapsed',
                groups: this.buildKpiVerdictGroups(s.rows, s.key)
            };
        });
    }

    // Build the Met / Partial / Missed / NA verdict sub-groups for one section.
    buildKpiVerdictGroups(rows, sectionKey) {
        const buckets = {
            met: { verdict: 'met', label: 'Met', icon: '✅', headClass: 'mca-kpigrp-head met', rows: [] },
            partial: { verdict: 'partial', label: 'Partially met', icon: '◐', headClass: 'mca-kpigrp-head partial', rows: [] },
            missed: { verdict: 'missed', label: 'Missed', icon: '✖', headClass: 'mca-kpigrp-head missed', rows: [] },
            na: { verdict: 'na', label: 'Not applicable', icon: '—', headClass: 'mca-kpigrp-head na', rows: [] }
        };
        rows.forEach((k) => {
            const a = (k.answer || '').trim().toLowerCase();
            let b = 'missed';
            if (a === 'yes' || a === 'y' || a === 'true') b = 'met';
            else if (a === 'partial') b = 'partial';
            else if (a === 'na' || a === 'n/a' || a === 'not applicable') b = 'na';
            buckets[b].rows.push(k);
        });
        return ['met', 'partial', 'missed', 'na']
            .map((k) => buckets[k])
            .filter((g) => g.rows.length > 0)
            .map((g, i) => {
                // Collapsible: default = only the FIRST group open, rest closed.
                const gKey = `${sectionKey}-${g.verdict}`;
                const override = this.collapsedKpi[gKey];
                const open = override ? override === 'open' : i === 0;
                return {
                    ...g,
                    key: gKey,
                    count: g.rows.length,
                    open,
                    caret: open ? '⌄' : '›',
                    bodyClass: open ? 'mca-kpigrp-body' : 'mca-kpigrp-body mca-kpigrp-collapsed'
                };
            });
    }

    get hasCallKpiSections() { return this.callKpiSections.length > 0; }

    handleKpiToggle(event) {
        const key = event.currentTarget.dataset.key;
        const wasOpen = event.currentTarget.dataset.open === 'true';
        this.collapsedKpi = { ...this.collapsedKpi, [key]: wasOpen ? 'closed' : 'open' };
    }

    /* ------------------------------------------------------------------ */
    /*  Call media (real): recording player URL + transcript text.         */
    /* ------------------------------------------------------------------ */
    get callAudioUrl() { return (this.masterCallMedia && this.masterCallMedia.audioUrl) || ''; }
    get hasCallAudio() { return !!this.callAudioUrl; }
    get callTranscript() { return (this.masterCallMedia && this.masterCallMedia.transcript) || ''; }
    get hasCallTranscript() { return !!(this.callTranscript && this.callTranscript.trim()); }
    get hasCallMedia() { return this.hasCallAudio || this.hasCallTranscript; }

    // Split the plain transcript into speaker-tagged lines where possible.
    // The source is unstructured text, so we heuristically break on "Agent:" /
    // "Customer:" cues; otherwise fall back to a single readable block.
    get callTranscriptLines() {
        const t = this.callTranscript;
        if (!t) { return []; }
        // If the transcript already uses explicit speaker labels, split on them.
        const labelled = t.split(/(?=\b(?:Agent|Customer|Caller|Rep|Representative)\s*:)/g)
            .map((s) => s.trim())
            .filter(Boolean);
        if (labelled.length > 1) {
            return labelled.map((line, i) => {
                const m = line.match(/^(Agent|Customer|Caller|Rep|Representative)\s*:\s*(.*)$/s);
                const speaker = m ? m[1] : '';
                const text = m ? m[2] : line;
                const isAgent = /agent|rep/i.test(speaker);
                return {
                    key: `tl-${i}`,
                    speaker,
                    text,
                    hasSpeaker: !!speaker,
                    rowClass: isAgent ? 'mca-tr-line agent' : 'mca-tr-line customer'
                };
            });
        }
        // Fallback: sentence-chunk the block so it stays readable.
        return t.split(/(?<=[.?!])\s+/).filter(Boolean).map((s, i) => ({
            key: `tl-${i}`, speaker: '', text: s, hasSpeaker: false, rowClass: 'mca-tr-line'
        }));
    }

    /* ----- Master drill-down navigation ----- */
    handleMasterLeadTypeSelect(event) {
        this.masterLeadTypeKey = event.currentTarget.dataset.key;
        this.masterDrillView = 'agent';
    }

    handleMasterAgentSelect(event) {
        this.masterAgentKey = event.currentTarget.dataset.key;
        this.masterDrillView = 'record';
    }

    handleMasterRecordOpen(event) {
        this.masterCallId = event.currentTarget.dataset.leadid;
        this.masterDrillView = 'call';
        this.loadMasterCallDetail(this.masterCallId);
    }

    loadMasterCallDetail(leadId) {
        this.masterCallDetail = null;
        this.masterCallMedia = null;
        this.masterCallDetailLoading = true;
        getCallAnalysis({ leadId })
            .then((json) => {
                this.masterCallDetail = json ? JSON.parse(json) : null;
                this.masterCallDetailLoading = false;
            })
            .catch((error) => {
                this.masterCallDetailLoading = false;
                this.masterCallDetail = null;
                console.error('Error loading call detail:', error);
                this.showToast('Error', this.extractError(error, 'Failed to load call analysis'), 'error');
            });
        // Companion media (transcript + recording) — non-blocking; failure is silent.
        getCallMedia({ leadId })
            .then((media) => { this.masterCallMedia = media || null; })
            .catch((error) => { console.error('Error loading call media:', error); this.masterCallMedia = null; });
    }

    handleMasterBackToLeadTypes() {
        this.masterDrillView = 'leadType';
        this.masterLeadTypeKey = null;
        this.masterAgentKey = null;
    }

    handleMasterBackToAgents() {
        this.masterDrillView = 'agent';
        this.masterAgentKey = null;
    }

    handleMasterBackToRecords() {
        this.masterDrillView = 'record';
        this.masterCallId = null;
        this.masterCallDetail = null;
        this.masterCallMedia = null;
    }

    // Open the underlying Lead record in a new tab (from any individual-analysis view).
    // The leadId can come from the clicked button (data-leadid) or the current call.
    handleOpenLeadRecord(event) {
        const leadId = (event && event.currentTarget && event.currentTarget.dataset.leadid) || this.masterCallId;
        if (!leadId) { return; }
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: leadId,
                objectApiName: 'Lead',
                actionName: 'view'
            }
        });
    }

    /* ============================================================ */
    /*  MY TEAM (Apex-driven): agent leaderboard → agent view → call */
    /* ============================================================ */
    get isTeamAgentList() { return this.isTeam && this.teamDrillView === 'agents'; }
    get isTeamAgentView() { return this.isTeam && this.teamDrillView === 'agent'; }
    get isTeamCallView() { return this.isTeam && this.teamDrillView === 'call'; }

    // Team KPI tiles (whole result set)
    get teamTotalCalls() { return this.masterTotalCalls; }
    get teamAgentCount() { return this.teamLeaderboard.length; }
    get teamAvgDisplay() { return this.masterAvgDisplay; }
    get teamFatalCount() { return this.masterFatalCount; }

    // Leaderboard: one row per agent, from the byAgent rollup (Apex-computed),
    // enriched with per-agent sentiment + weakest parameter from the calls list.
    get teamLeaderboard() {
        const byAgent = (this.masterData && this.masterData.byAgent) || [];
        // per-agent positive-sentiment counts
        const posByAgent = {};
        const totalByAgent = {};
        this.masterCalls.forEach((c) => {
            const key = c.agentName || 'Unassigned';
            totalByAgent[key] = (totalByAgent[key] || 0) + 1;
            if (c.sentiment === 'Positive') { posByAgent[key] = (posByAgent[key] || 0) + 1; }
        });
        return byAgent
            .map((g) => {
                const avg = Number(g.avgScore) || 0;
                const total = totalByAgent[g.key] || g.count || 1;
                const posPct = Math.round(((posByAgent[g.key] || 0) / total) * 100);
                return {
                    key: g.key,
                    name: g.key,
                    initials: this.initialsOf(g.key),
                    count: g.count,
                    avgDisplay: `${avg.toFixed(2)} / ${MASTER_SCALE_MAX}`,
                    scoreBadgeClass: this.masterStatusBadge(avg),
                    weakest: g.weakestParam ? (METRIC_LABELS[g.weakestParam] || g.weakestParam) : '—',
                    fatalCount: g.fatalCount || 0,
                    hasFatal: (g.fatalCount || 0) > 0,
                    sentimentPct: `${posPct}%`,
                    _sort: avg
                };
            })
            .sort((a, b) => b._sort - a._sort);
    }

    get hasTeamData() { return this.hasMasterData; }

    get teamSelectedAgentName() { return this.teamAgentKey || ''; }

    // Selected agent's calls
    get teamAgentCalls() {
        return this.masterCalls.filter((c) => (c.agentName || 'Unassigned') === this.teamAgentKey);
    }

    // High-level per-agent analysis: score-by-parameter averaged across their calls
    get teamAgentParameterRows() {
        return this.parameterRowsForCalls(this.teamAgentCalls);
    }

    // Selected agent's summary tiles
    get teamAgentSummary() {
        return this.summaryForCalls(this.teamAgentCalls);
    }

    // Selected agent's call records (reuses the master record-row shape)
    get teamAgentRecordRows() {
        return this.recordRowsForCalls(this.teamAgentCalls);
    }

    /* ----- Per-agent rubric compliance (KPI compliance across all their calls) ----- */
    get hasAgentRubric() {
        return !!(this.agentRubric && (this.agentRubric.categories || []).length);
    }

    get agentRubricOverall() {
        const c = Number((this.agentRubric && this.agentRubric.overallCompliance) || 0);
        const band = this.complianceBand(c);
        return { pct: `${Math.round(c)}%`, color: band.color, pillStyle: `color:${band.color};border-color:${this.hexToTint(band.color, 0.4)};background:${this.hexToTint(band.color, 0.08)};` };
    }

    // Shape the Apex AgentRubric into render-ready categories + sub-parameter rows.
    get agentRubricCategories() {
        const cats = (this.agentRubric && this.agentRubric.categories) || [];
        return cats.map((cat) => {
            const compliant = cat.compliance != null;
            const band = this.complianceBand(Number(cat.compliance) || 0);
            const subs = (cat.subParams || []).map((s) => {
                const applicable = !!s.applicable;
                const met = Number(s.compliance) || 0;
                const sband = this.complianceBand(met);
                return {
                    code: s.code,
                    question: s.question,
                    critical: !!s.critical,
                    applicable,
                    weightLabel: applicable ? `${Number(s.avgScore).toFixed(1)}` : '—',
                    weight: s.weight,
                    metPct: applicable ? `${Math.round(met)}%` : 'NA',
                    metStyle: applicable ? `color:${sband.color};` : 'color:var(--slds-neutral-60,#9CA3AF);',
                    barStyle: applicable
                        ? `width:${Math.round(met)}%;background:${sband.color};`
                        : 'width:0%;',
                    naRow: !applicable,
                    title: applicable
                        ? `Avg score ${Number(s.avgScore).toFixed(1)}/5 · ${met.toFixed(0)}% met across ${s.applicableCount} call(s)`
                        : 'Not observed on any analysed call',
                    ...this.buildSparkline(s.spark, sband.color)
                };
            });
            return {
                key: cat.name,
                name: cat.name,
                icon: cat.icon,
                headerLabel: compliant
                    ? `Compliance ${Math.round(cat.compliance)}% · Weight ${cat.weight}`
                    : `No audio-observable data · Weight ${cat.weight}`,
                headerStyle: compliant ? `color:${band.color};` : 'color:var(--slds-neutral-60,#9CA3AF);',
                isWeakest: !!cat.isWeakest,
                subParams: subs
            };
        });
    }

    // Map a compliance % to the shared green/amber/red band.
    complianceBand(pct) {
        const p = Number(pct) || 0;
        if (p >= 80) return { color: '#16A34A' };
        if (p >= 65) return { color: '#65A30D' };
        if (p >= 50) return { color: '#D97706' };
        return { color: '#DC2626' };
    }

    // Build an SVG polyline for a sub-parameter's running met-rate over time.
    buildSparkline(series, color) {
        const vals = (series || []).map((v) => Number(v) || 0);
        if (vals.length < 2) {
            return { hasSpark: false, sparkPoints: '', sparkColor: color };
        }
        const W = 64;
        const H = 22;
        const pad = 3;
        const n = vals.length;
        const pts = vals.map((v, i) => {
            const x = pad + (i * (W - 2 * pad)) / (n - 1);
            const y = H - pad - (v / 100) * (H - 2 * pad);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        return { hasSpark: true, sparkPoints: pts.join(' '), sparkColor: color };
    }

    /* ----- Team score-by-parameter matrix (agent × 6 params) ----- */
    // Column headers for the matrix, in fixed order.
    get teamMatrixColumns() {
        return Object.keys(METRIC_LABELS).map((k) => ({ key: k, label: METRIC_LABELS[k] }));
    }

    // One row per agent, one colour-coded chip per quality parameter — all
    // averaged from real per-call metrics (1–5 scale).
    get teamMatrixRows() {
        const cols = Object.keys(METRIC_LABELS);
        // group calls by agent
        const byAgent = {};
        this.masterCalls.forEach((c) => {
            const a = c.agentName || 'Unassigned';
            if (!byAgent[a]) { byAgent[a] = []; }
            byAgent[a].push(c);
        });
        return Object.keys(byAgent)
            .map((a) => {
                const calls = byAgent[a];
                const sums = {};
                const counts = {};
                calls.forEach((c) => {
                    const m = c.metrics || {};
                    cols.forEach((k) => {
                        if (m[k] != null) {
                            sums[k] = (sums[k] || 0) + Number(m[k]);
                            counts[k] = (counts[k] || 0) + 1;
                        }
                    });
                });
                let overall = 0; let oc = 0;
                const cells = cols.map((k) => {
                    if (!counts[k]) {
                        return { key: `${a}-${k}`, display: '—', chipClass: 'mca-mx-chip mca-mx-na' };
                    }
                    const val = sums[k] / counts[k];
                    overall += val; oc++;
                    let tone = 'mca-mx-lo';
                    if (val >= 4.0) tone = 'mca-mx-hi';
                    else if (val >= 3.0) tone = 'mca-mx-mid';
                    return { key: `${a}-${k}`, display: val.toFixed(1), chipClass: `mca-mx-chip ${tone}` };
                });
                return {
                    key: a,
                    name: a,
                    initials: this.initialsOf(a),
                    cells,
                    _sort: oc ? overall / oc : 0
                };
            })
            .sort((x, y) => y._sort - x._sort);
    }

    get hasTeamMatrix() { return this.teamMatrixRows.length > 0; }

    /* ----- Coaching priorities: real, ranked from the leaderboard ----- */
    // Surfaces the agents who most need coaching, with a real reason line
    // built from their weakest parameter, fatal count, and positive sentiment.
    get teamCoachingPriorities() {
        return this.teamLeaderboard
            .filter((ag) => ag.hasFatal || ag._sort < 4.0)
            .slice(0, 5)
            .map((ag) => {
                let accent = '#D97706';
                if (ag.hasFatal) accent = '#DC2626';
                else if (ag._sort < 3.0) accent = '#DC2626';
                const bits = [];
                if (ag.hasFatal) {
                    bits.push(`${ag.fatalCount} fatal interaction${ag.fatalCount === 1 ? '' : 's'} flagged`);
                }
                if (ag.weakest && ag.weakest !== '—') {
                    bits.push(`weakest area is ${ag.weakest}`);
                }
                bits.push(`${ag.sentimentPct} positive sentiment across ${ag.count} call${ag.count === 1 ? '' : 's'}`);
                return {
                    key: ag.key,
                    name: ag.name,
                    initials: ag.initials,
                    avgDisplay: ag.avgDisplay,
                    scoreBadgeClass: ag.scoreBadgeClass,
                    reason: bits.join(' · '),
                    cardStyle: `border-left:4px solid ${accent};background:${this.hexToTint(accent, 0.06)};`,
                    dotStyle: `background:${accent};`
                };
            });
    }

    get hasTeamCoachingPriorities() { return this.teamCoachingPriorities.length > 0; }

    handleTeamPriorityOpen(event) {
        this.teamAgentKey = event.currentTarget.dataset.key;
        this.teamDrillView = 'agent';
        this.loadAgentRubric(this.teamAgentKey);
    }

    /* ----- My Team navigation ----- */
    handleTeamAgentSelect(event) {
        this.teamAgentKey = event.currentTarget.dataset.key;
        this.teamDrillView = 'agent';
        this.loadAgentRubric(this.teamAgentKey);
    }

    // Fetch the agent's rubric-compliance rollup (KPI compliance across all their calls).
    loadAgentRubric(agentName) {
        this.agentRubric = null;
        if (!agentName) { return; }
        this.agentRubricLoading = true;
        getAgentRubric({
            agentName,
            startDate: this.filterStartDate || null,
            endDate: this.filterEndDate || null
        })
            .then((result) => {
                this.agentRubric = result;
                this.agentRubricLoading = false;
            })
            .catch((error) => {
                this.agentRubric = null;
                this.agentRubricLoading = false;
                console.error('Error loading agent rubric:', error);
            });
    }

    handleTeamRecordOpen(event) {
        // Reuse the master L4 call view machinery
        this.masterCallId = event.currentTarget.dataset.leadid;
        this.teamDrillView = 'call';
        this.loadMasterCallDetail(this.masterCallId);
    }

    handleTeamBackToAgents() {
        this.teamDrillView = 'agents';
        this.teamAgentKey = null;
        this.agentRubric = null;
    }

    handleTeamBackToAgent() {
        this.teamDrillView = 'agent';
        this.masterCallId = null;
        this.masterCallDetail = null;
        this.masterCallMedia = null;
    }

    /* ============================================================ */
    /*  SCORECARD (isAgent, Apex-driven): agent picker → scorecard   */
    /* ============================================================ */
    get isScorecardPicker() { return this.isAgent && !this.scorecardAgentKey; }
    get isScorecardDetail() { return this.isAgent && !!this.scorecardAgentKey; }

    // Reuse the leaderboard rows as the agent picker.
    get scorecardAgents() { return this.teamLeaderboard; }
    get hasScorecardData() { return this.hasMasterData; }

    get scorecardSelectedAgentName() { return this.scorecardAgentKey || ''; }

    get scorecardCalls() {
        return this.masterCalls.filter((c) => (c.agentName || 'Unassigned') === this.scorecardAgentKey);
    }

    get scorecardSummary() { return this.summaryForCalls(this.scorecardCalls); }
    get scorecardParameterRows() { return this.parameterRowsForCalls(this.scorecardCalls); }
    get scorecardRecordRows() { return this.recordRowsForCalls(this.scorecardCalls); }

    // Coaching feed: real per-call scope-of-improvement notes for this agent,
    // clubbed by weakest parameter (see groupCoaching).
    get scorecardCoaching() {
        // Single agent → group by theme only, no agent sub-grouping.
        return this.groupCoaching(this.scorecardCalls, 'sc-coach', false);
    }

    get hasScorecardCoaching() { return this.scorecardCoaching.length > 0; }

    // Strongest / weakest parameter for the scorecard header
    get scorecardHighlights() {
        const rows = this.scorecardParameterRows;
        if (!rows.length) { return { strongest: '—', weakest: '—' }; }
        let strongest = rows[0];
        let weakest = rows[0];
        rows.forEach((r) => {
            if (r._value > strongest._value) strongest = r;
            if (r._value < weakest._value) weakest = r;
        });
        return {
            strongest: `${strongest.label} (${strongest._value.toFixed(2)})`,
            weakest: `${weakest.label} (${weakest._value.toFixed(2)})`
        };
    }

    handleScorecardSelect(event) {
        this.scorecardAgentKey = event.currentTarget.dataset.key;
    }

    handleScorecardBack() {
        this.scorecardAgentKey = null;
    }

    /* ============================================================ */
    /*  BUSINESS INSIGHTS (isInsights) — only JSON-derivable signals  */
    /* ============================================================ */
    get hasInsightsData() { return this.hasMasterData; }

    // Sentiment mix across all analysed calls (reuses master computation).
    get insightsSentiment() { return this.masterSentiment; }

    get insightsSentimentBars() {
        const s = this.masterSentiment;
        return {
            positive: `width:${s.positivePct}%;background:#2e844a;`,
            neutral: `width:${s.neutralPct}%;background:#fe9339;`,
            negative: `width:${s.negativePct}%;background:#ba0517;`
        };
    }

    // Average quality score by lead type (from the Apex byLeadType rollup).
    get insightsByLeadType() {
        const byType = (this.masterData && this.masterData.byLeadType) || [];
        return byType
            .map((g) => {
                const avg = Number(g.avgScore) || 0;
                const pct = Math.round((avg / MASTER_SCALE_MAX) * 100);
                let color = '#ba0517';
                if (avg >= 4.0) color = '#2e844a';
                else if (avg >= 3.0) color = '#fe9339';
                return {
                    key: g.key,
                    label: LEAD_TYPE_LABELS[g.key] || g.key,
                    count: g.count,
                    countLabel: `${g.count} call${g.count === 1 ? '' : 's'}`,
                    avgDisplay: `${avg.toFixed(2)} / ${MASTER_SCALE_MAX}`,
                    barStyle: `width:${pct}%;background:${color};`,
                    _sort: g.count
                };
            })
            .sort((a, b) => b._sort - a._sort);
    }

    get hasInsightsByLeadType() { return this.insightsByLeadType.length > 0; }

    // Which quality parameter is the weakest most often — a real coaching signal.
    get insightsWeakestDist() {
        const counts = {};
        let total = 0;
        this.masterCalls.forEach((c) => {
            if (c.weakestParam) {
                counts[c.weakestParam] = (counts[c.weakestParam] || 0) + 1;
                total++;
            }
        });
        const denom = total || 1;
        return Object.keys(counts)
            .map((k) => {
                const count = counts[k];
                const pct = Math.round((count / denom) * 100);
                return {
                    key: k,
                    label: METRIC_LABELS[k] || this.formatMetricLabel(k),
                    count,
                    countLabel: `${count} call${count === 1 ? '' : 's'} · ${pct}%`,
                    barStyle: `width:${pct}%;background:#ba0517;`,
                    _sort: count
                };
            })
            .sort((a, b) => b._sort - a._sort);
    }

    get hasInsightsWeakestDist() { return this.insightsWeakestDist.length > 0; }

    /* ----- KPI adherence: where agents most often miss the mark ----- */
    // Aggregated from the per-call kpiEvaluations[] (Yes / Partial / No per
    // scored question). We surface the questions with the LOWEST met-rate first
    // — the real, granular "opportunity mining" signal. All from stored data.
    get insightsKpiAdherence() {
        const rows = (this.masterData && this.masterData.kpiAdherence) || [];
        // Require a meaningful sample before a question can be ranked — otherwise
        // one-off ad-hoc questions (n=1) show a fake "0% met · Critical gap".
        // Floor of 3, scaling to ~15% of the analysed calls on larger sets.
        const minSample = Math.max(3, Math.ceil((this.masterTotalCalls || 0) * 0.15));
        return rows
            .filter((r) => (r.applicableCount || 0) >= minSample)
            .map((r) => {
                const met = Number(r.metRate) || 0;
                const yes = r.yesCount || 0;
                const partial = r.partialCount || 0;
                const no = r.noCount || 0;
                const total = r.applicableCount || (yes + partial + no) || 1;
                // Colour by how well the behaviour is met.
                let color = '#DC2626';
                let tagLabel = 'Critical gap';
                if (met >= 80) { color = '#16A34A'; tagLabel = 'Consistent'; }
                else if (met >= 60) { color = '#2563EB'; tagLabel = 'Mostly met'; }
                else if (met >= 40) { color = '#D97706'; tagLabel = 'Inconsistent'; }
                else if (met >= 20) { color = '#EA580C'; tagLabel = 'Frequently missed'; }
                return {
                    key: r.question,
                    label: r.question,
                    metPct: `${met.toFixed(0)}%`,
                    barStyle: `width:${met.toFixed(0)}%;background:${color};`,
                    // stacked Yes/Partial/No mini-segments
                    yesStyle: `width:${((yes / total) * 100).toFixed(1)}%;background:#16A34A;`,
                    partialStyle: `width:${((partial / total) * 100).toFixed(1)}%;background:#D97706;`,
                    noStyle: `width:${((no / total) * 100).toFixed(1)}%;background:#DC2626;`,
                    splitLabel: `${yes} met · ${partial} partial · ${no} missed`,
                    countLabel: `${total} call${total === 1 ? '' : 's'}`,
                    tagLabel,
                    tagStyle: `color:${color};border-color:${this.hexToTint(color, 0.4)};background:${this.hexToTint(color, 0.08)};`,
                    _sort: met
                };
            })
            .sort((a, b) => a._sort - b._sort) // worst-adhered first
            .slice(0, 8);
    }

    get hasInsightsKpiAdherence() { return this.insightsKpiAdherence.length > 0; }

    // The single worst-adhered behaviour — drives a headline callout.
    get insightsKpiTopGap() {
        const rows = this.insightsKpiAdherence;
        return rows.length ? rows[0] : null;
    }

    /* ----- Sentiment trajectory: did the call end better than it started? ----- */
    // From aiInsights.sentimentDetail.start vs .end on each call — a real
    // measure of whether agents turn conversations around.
    get insightsSentimentJourney() {
        const shift = (this.masterData && this.masterData.sentimentShift) || {};
        const improved = shift.improved || 0;
        const held = shift.held || 0;
        const declined = shift.declined || 0;
        const total = improved + held + declined || 1;
        const pct = (n) => Math.round((n / total) * 100);

        // Opening vs closing sentiment mix — counts calls that HAVE both bookends
        // so the two bars are comparable and total the same denominator.
        const open = { Positive: 0, Neutral: 0, Negative: 0 };
        const close = { Positive: 0, Neutral: 0, Negative: 0 };
        const bucket = (v) => {
            const s = String(v || '').toLowerCase();
            if (s.includes('positive')) return 'Positive';
            if (s.includes('negative')) return 'Negative';
            if (s.includes('neutral')) return 'Neutral';
            return null;
        };
        let measured = 0;
        this.masterCalls.forEach((c) => {
            const s0 = bucket(c.sentimentStart);
            const s1 = bucket(c.sentimentEnd);
            if (!s0 || !s1) return;
            measured++;
            open[s0]++;
            close[s1]++;
        });
        const den = measured || 1;
        const seg = (n) => `${Math.round((n / den) * 100)}%`;
        const bookends = [
            {
                key: 'open', label: 'Call opening',
                posStyle: `width:${seg(open.Positive)};background:#16A34A;`,
                neuStyle: `width:${seg(open.Neutral)};background:#94A3B8;`,
                negStyle: `width:${seg(open.Negative)};background:#DC2626;`,
                caption: `${seg(open.Positive)} positive · ${seg(open.Negative)} negative`
            },
            {
                key: 'close', label: 'Call close',
                posStyle: `width:${seg(close.Positive)};background:#16A34A;`,
                neuStyle: `width:${seg(close.Neutral)};background:#94A3B8;`,
                negStyle: `width:${seg(close.Negative)};background:#DC2626;`,
                caption: `${seg(close.Positive)} positive · ${seg(close.Negative)} negative`
            }
        ];

        return {
            improved,
            held,
            declined,
            total: improved + held + declined,
            improvedPct: pct(improved),
            heldPct: pct(held),
            declinedPct: pct(declined),
            improvedBarStyle: `width:${pct(improved)}%;background:#16A34A;`,
            heldBarStyle: `width:${pct(held)}%;background:#94A3B8;`,
            declinedBarStyle: `width:${pct(declined)}%;background:#DC2626;`,
            // Net turnaround score = improved − declined, as a % of measured calls.
            netLabel: `${pct(improved) - pct(declined) >= 0 ? '+' : ''}${pct(improved) - pct(declined)}%`,
            netPositive: improved >= declined,
            bookends,
            openPosPct: seg(open.Positive),
            closePosPct: seg(close.Positive)
        };
    }

    get hasInsightsSentimentJourney() {
        return this.insightsSentimentJourney.total > 0;
    }

    /* ============================================================ */
    /*  ◇ ILLUSTRATIVE PANELS (MOCK — no live source field yet)       */
    /*  These mirror the "Voice of Customer" mockup sections that have */
    /*  NO backing field in Audio_Analysis__c (competitor, pricing,    */
    /*  product/revenue, campaign, region). Values are fixed sample    */
    /*  data and DO NOT change with the record set. The ◇ glyph in     */
    /*  each card title marks them as illustrative. To make one real,  */
    /*  add/populate the source field (or extend the analysis prompt)  */
    /*  and replace the getter body with an aggregation over calls.    */
    /* ============================================================ */

    // ◇ Top requested categories — horizontal bars with counts (mockup 1, left).
    get mockTopCategories() {
        const rows = [
            { key: 't1', label: 'Bridal', count: 8144 },
            { key: 't2', label: 'Everyday wear', count: 6020 },
            { key: 't3', label: 'Solitaires', count: 4240 },
            { key: 't4', label: 'Gifting', count: 3620 },
            { key: 't5', label: 'Kids', count: 1580 },
            { key: 't6', label: "Men's", count: 1256 }
        ];
        const max = Math.max(...rows.map((r) => r.count));
        return rows.map((r) => ({
            key: r.key,
            label: r.label,
            countLabel: r.count.toLocaleString('en-IN'),
            barStyle: `width:${Math.round((r.count / max) * 100)}%;background:#2563EB;`
        }));
    }

    // ◇ Design preference trends — tag cloud, size = volume, ▲▼ = trend.
    get mockDesignTrends() {
        // tone: 'up' | 'down' | 'flat'; size: 'lg' | 'md' | 'sm'
        const tags = [
            { key: 'd1', label: 'Minimalist', tone: 'up', size: 'lg' },
            { key: 'd2', label: 'Temple', tone: 'flat', size: 'sm' },
            { key: 'd3', label: 'Contemporary', tone: 'flat', size: 'lg' },
            { key: 'd4', label: 'Diamond-heavy', tone: 'up', size: 'md' },
            { key: 'd5', label: 'Polki', tone: 'flat', size: 'sm' },
            { key: 'd6', label: 'Antique gold', tone: 'flat', size: 'md' },
            { key: 'd7', label: 'Kundan', tone: 'flat', size: 'sm' },
            { key: 'd8', label: 'Heavy traditional', tone: 'down', size: 'md' },
            { key: 'd9', label: 'Stackable', tone: 'flat', size: 'md' },
            { key: 'd10', label: 'Meenakari', tone: 'flat', size: 'sm' }
        ];
        return tags.map((t) => {
            const arrow = t.tone === 'up' ? ' ▲' : t.tone === 'down' ? ' ▼' : '';
            return {
                key: t.key,
                text: `${t.label}${arrow}`,
                chipClass: `mca-mock-tag mca-mock-tag-${t.size} mca-mock-tag-${t.tone}`
            };
        });
    }

    // ◇ Product gaps & unmet needs — callout cards (mockup 1, right).
    get mockProductGaps() {
        const rows = [
            { key: 'g1', title: 'Lightweight bridal under ₹1L', desc: '412 requests for "small bridal set" priced under ₹1 lakh — no SKU currently matches.', tone: 'amber' },
            { key: 'g2', title: "Men's solitaire rings", desc: "284 explicit asks; men's collection currently lacks solitaire options.", tone: 'amber' },
            { key: 'g3', title: 'Detachable bridal pieces', desc: '167 asks — bridal necklace that converts to daily-wear.', tone: 'blue' }
        ];
        const tone = { amber: '#D97706', blue: '#2563EB' };
        return rows.map((r) => ({
            key: r.key,
            title: r.title,
            desc: r.desc,
            cardStyle: `border-left:4px solid ${tone[r.tone]};background:${this.hexToTint(tone[r.tone], 0.07)};`,
            titleStyle: `color:${tone[r.tone]};`
        }));
    }

    // ◇ Store vs. digital preference — donut + legend (mockup 2, left).
    get mockChannelSplit() {
        const rows = [
            { key: 'ch1', label: 'Store-first', pct: 58, color: '#2563EB' },
            { key: 'ch2', label: 'Digital-first', pct: 28, color: '#7C3AED' },
            { key: 'ch3', label: 'Hybrid', pct: 14, color: '#16A34A' }
        ];
        const circ = 175.9; // 2πr, r=28
        let offset = 0;
        const segments = [];
        const legend = rows.map((r) => {
            const len = (r.pct / 100) * circ;
            segments.push({
                key: r.key,
                style: `stroke:${r.color};stroke-dasharray:${len.toFixed(1)} ${circ};stroke-dashoffset:${(-offset).toFixed(1)};`
            });
            offset += len;
            return { key: r.key, label: r.label, pctLabel: `${r.pct}%`, dotStyle: `background:${r.color};` };
        });
        return { segments, legend, topPct: `${rows[0].pct}%`, topLabel: rows[0].label };
    }

    // ◇ Fulfilment friction — complaint bars (mockup 2, middle).
    get mockFulfilment() {
        const rows = [
            { key: 'f1', label: 'Stock unavailable', count: 1842, color: '#B91C1C' },
            { key: 'f2', label: 'Delivery delay', count: 1304, color: '#B91C1C' },
            { key: 'f3', label: 'Store pickup wait', count: 988, color: '#EA580C' },
            { key: 'f4', label: 'Wrong item shipped', count: 492, color: '#EA580C' },
            { key: 'f5', label: 'Reservation not held', count: 408, color: '#EA580C' }
        ];
        const max = Math.max(...rows.map((r) => r.count));
        return rows.map((r) => ({
            key: r.key,
            label: r.label,
            countLabel: r.count.toLocaleString('en-IN'),
            barStyle: `width:${Math.round((r.count / max) * 100)}%;background:${r.color};`
        }));
    }

    // ◇ Drop-off reasons by channel — heatmap table (mockup 2, right).
    get mockDropoffMatrix() {
        // each cell: pct + intensity (0-1) for tint
        const rows = [
            { key: 'dr1', reason: 'Price', call: 32, store: 24, web: 41 },
            { key: 'dr2', reason: 'Stock', call: 22, store: 38, web: 14 },
            { key: 'dr3', reason: 'Consultation gap', call: 12, store: 6, web: 28 },
            { key: 'dr4', reason: 'Family decision', call: 18, store: 20, web: 10 },
            { key: 'dr5', reason: 'Delivery timing', call: 10, store: 4, web: 12 }
        ];
        const cell = (v) => {
            // deeper blue as % rises (mockup uses a blue heat scale)
            let bg = '#EFF6FF'; let fg = '#1D4ED8';
            if (v >= 35) { bg = '#1E3A8A'; fg = '#FFFFFF'; }
            else if (v >= 25) { bg = '#3B82F6'; fg = '#FFFFFF'; }
            else if (v >= 15) { bg = '#93C5FD'; fg = '#1E3A8A'; }
            else if (v >= 8) { bg = '#DBEAFE'; fg = '#1E40AF'; }
            return { display: `${v}%`, style: `background:${bg};color:${fg};` };
        };
        return rows.map((r) => ({
            key: r.key,
            reason: r.reason,
            call: cell(r.call),
            store: cell(r.store),
            web: cell(r.web)
        }));
    }

    // ◇ Sentiment across categories & regions — heatmap table (mockup 3, left).
    get mockSentimentMatrix() {
        const rows = [
            { key: 'sm1', cat: 'Bridal', north: 0.72, south: 0.68, east: 0.58, west: 0.74, all: 0.68 },
            { key: 'sm2', cat: 'Everyday', north: 0.52, south: 0.61, east: 0.48, west: 0.54, all: 0.54 },
            { key: 'sm3', cat: 'Solitaires', north: 0.48, south: 0.42, east: 0.18, west: 0.52, all: 0.40 },
            { key: 'sm4', cat: 'Gifting', north: 0.62, south: 0.58, east: 0.55, west: 0.60, all: 0.59 },
            { key: 'sm5', cat: 'Kids', north: 0.44, south: 0.51, east: 0.22, west: 0.38, all: 0.39 }
        ];
        const cell = (v) => {
            const pos = v >= 0.35;
            return {
                display: `+${v.toFixed(2)}`,
                style: pos ? 'background:#DCFCE7;color:#15803D;' : 'background:#FEE2E2;color:#B91C1C;'
            };
        };
        return rows.map((r) => ({
            key: r.key,
            cat: r.cat,
            north: cell(r.north),
            south: cell(r.south),
            east: cell(r.east),
            west: cell(r.west),
            allLabel: `+${r.all.toFixed(2)}`
        }));
    }

    /* ------------------------------------------------------------ */
    /*  Voice-of-customer keyword cards — DYNAMIC, mined from what   */
    /*  the CUSTOMER actually said (timelineHighlights). See         */
    /*  MasterCallAuditController.mineKeywords / rankKeywords.        */
    /* ------------------------------------------------------------ */

    // Title-case a mined term for display ("gold coin" → "Gold coin").
    titleCase(term) {
        if (!term) { return ''; }
        return term.charAt(0).toUpperCase() + term.slice(1);
    }

    // Positive drivers — terms customers used in positive-sentiment moments.
    get insightsPositiveDrivers() {
        const rows = (this.masterData && this.masterData.positiveDrivers) || [];
        const top = rows.slice(0, 10);
        return top.map((r, i) => ({
            key: `pd-${i}`,
            label: this.titleCase(r.term),
            // Emphasise the top third (highest frequency) as "strong".
            chipClass: `mca-mock-pill mca-mock-pill-pos${i < Math.ceil(top.length / 3) ? ' strong' : ''}`
        }));
    }

    get hasInsightsPositiveDrivers() { return this.insightsPositiveDrivers.length > 0; }

    // Negative triggers — terms from real customer objections.
    get insightsNegativeTriggers() {
        const rows = (this.masterData && this.masterData.negativeTriggers) || [];
        const top = rows.slice(0, 10);
        return top.map((r, i) => ({
            key: `nt-${i}`,
            label: this.titleCase(r.term),
            chipClass: `mca-mock-pill mca-mock-pill-neg${i < Math.ceil(top.length / 3) ? ' strong' : ''}`
        }));
    }

    get hasInsightsNegativeTriggers() { return this.insightsNegativeTriggers.length > 0; }

    // Brand keyword cloud — overall customer vocabulary; size = frequency,
    // tone = whether the term skewed positive or negative in context.
    get insightsBrandKeywords() {
        const rows = (this.masterData && this.masterData.brandKeywords) || [];
        if (!rows.length) { return []; }
        const max = Math.max(...rows.map((r) => Number(r.count) || 0), 1);
        return rows.map((r, i) => {
            const c = Number(r.count) || 0;
            const ratio = c / max;
            let size = 'sm';
            if (ratio >= 0.66) size = 'lg';
            else if (ratio >= 0.33) size = 'md';
            const pos = Number(r.posCount) || 0;
            const neg = Number(r.negCount) || 0;
            let tone = 'neu';
            if (pos > neg) tone = 'pos';
            else if (neg > pos) tone = 'neg';
            return {
                key: `bk-${i}`,
                label: this.titleCase(r.term),
                chipClass: `mca-mock-word mca-mock-word-${size} mca-mock-word-${tone}`
            };
        });
    }

    get hasInsightsBrandKeywords() { return this.insightsBrandKeywords.length > 0; }

    // Small caption showing the sample these are mined from.
    get insightsVocSubtitle() {
        const n = this.masterTotalCalls || 0;
        return `From what customers said across ${n} analysed call${n === 1 ? '' : 's'}`;
    }

    // ◇ Marketing & branding perception vs competitors — pill table (mockup 4, D-left).
    get mockBrandPerception() {
        // tone per cell: hi (green) / mid (amber) / lo (red)
        const rows = [
            { key: 'bp1', brand: 'Aurelia', us: true, recall: 54, compelling: 72, trust: 88 },
            { key: 'bp2', brand: 'Meridian', us: false, recall: 38, compelling: 58, trust: 72 },
            { key: 'bp3', brand: 'Kestrel', us: false, recall: 48, compelling: 62, trust: 74 },
            { key: 'bp4', brand: 'Jovian', us: false, recall: 32, compelling: 54, trust: 68 },
            { key: 'bp5', brand: 'Pinnacle Gems', us: false, recall: 18, compelling: 38, trust: 62 }
        ];
        const pill = (v, hi, mid) => {
            let cls = 'lo';
            if (v >= hi) cls = 'hi';
            else if (v >= mid) cls = 'mid';
            return { display: `${v}%`, chipClass: `mca-mock-pctpill ${cls}` };
        };
        const scorePill = (v) => {
            let cls = 'lo';
            if (v >= 80) cls = 'hi';
            else if (v >= 68) cls = 'mid';
            return { display: `${v}`, chipClass: `mca-mock-pctpill ${cls}` };
        };
        return rows.map((r) => ({
            key: r.key,
            brand: r.brand,
            brandClass: r.us ? 'mca-mock-brand us' : 'mca-mock-brand',
            recall: pill(r.recall, 50, 35),
            compelling: pill(r.compelling, 65, 50),
            trust: scorePill(r.trust)
        }));
    }

    // ◇ Naturally recalled campaigns — bars, ours highlighted (mockup 4, D-right).
    get mockRecalledCampaigns() {
        const rows = [
            { key: 'rc1', label: 'Aurelia Bridal "A New Beginning" · A', pct: 62, ours: true },
            { key: 'rc2', label: 'Festive Glow · A', pct: 54, ours: true },
            { key: 'rc3', label: 'Kestrel Muhurat · K', pct: 48, ours: false },
            { key: 'rc4', label: 'Meridian M Series · M', pct: 38, ours: false },
            { key: 'rc5', label: 'Lumi everyday-luxe · A', pct: 38, ours: true },
            { key: 'rc6', label: 'Jovian Apoorva · J', pct: 32, ours: false }
        ];
        return rows.map((r) => ({
            key: r.key,
            label: r.label,
            pctLabel: `${r.pct}%`,
            barStyle: `width:${r.pct}%;background:${r.ours ? '#2563EB' : '#94A3B8'};`
        }));
    }

    // ◇ Store experience & service benchmarking — score matrix (mockup 4, E).
    get mockServiceBenchmark() {
        const rows = [
            { key: 'sb1', dim: 'Staff friendliness', t: 4.6, m: 4.2, k: 4.3, j: 4.1, p: 3.8, pos: 'Leading' },
            { key: 'sb2', dim: 'Store ambiance', t: 4.8, m: 4.1, k: 4.4, j: 4.2, p: 3.6, pos: 'Leading' },
            { key: 'sb3', dim: 'Delivery timelines', t: 4.0, m: 4.3, k: 4.1, j: 4.0, p: 3.7, pos: 'Behind Meridian' },
            { key: 'sb4', dim: 'Exchange / buyback experience', t: 4.7, m: 4.0, k: 4.1, j: 3.9, p: 3.5, pos: 'Leading' },
            { key: 'sb5', dim: 'Resizing / repair turnaround', t: 3.6, m: 4.0, k: 4.1, j: 3.9, p: 3.5, pos: 'Weakest area' },
            { key: 'sb6', dim: 'Consultation depth', t: 4.5, m: 4.0, k: 4.2, j: 4.1, p: 3.6, pos: 'Leading' }
        ];
        const scoreCell = (v, isUs) => {
            // blue heat by score; our column darker
            let bg = '#DBEAFE'; let fg = '#1E40AF';
            if (v >= 4.6) { bg = '#1E3A8A'; fg = '#FFFFFF'; }
            else if (v >= 4.2) { bg = isUs ? '#2563EB' : '#60A5FA'; fg = '#FFFFFF'; }
            else if (v >= 4.0) { bg = '#93C5FD'; fg = '#1E3A8A'; }
            return { display: v.toFixed(1), style: `background:${bg};color:${fg};` };
        };
        const posClass = (p) => {
            if (p === 'Leading') return 'mca-mock-pos lead';
            if (p === 'Weakest area') return 'mca-mock-pos weak';
            return 'mca-mock-pos behind';
        };
        return rows.map((r) => ({
            key: r.key,
            dim: r.dim,
            t: scoreCell(r.t, true),
            m: scoreCell(r.m, false),
            k: scoreCell(r.k, false),
            j: scoreCell(r.j, false),
            p: scoreCell(r.p, false),
            pos: r.pos,
            posClass: posClass(r.pos)
        }));
    }

    // Coaching feed: real scope-of-improvement notes, CLUBBED by the call's
    // weakest parameter so ~40 flat notes become a handful of themed groups.
    get insightsCoaching() {
        // Business Insights spans every agent → sub-group each theme by agent.
        return this.groupCoaching(this.masterCalls, 'ins-coach', true);
    }

    get hasInsightsCoaching() { return this.insightsCoaching.length > 0; }

    // Shared coaching-feed builder.
    //   Level 1 — theme = the call's weakest parameter (Empathy, Compliance …)
    //   Level 2 — (byAgent) sub-group notes by agent within each theme
    //   Level 3 — the individual scope-of-improvement notes
    groupCoaching(calls, prefix, byAgent) {
        const themes = {};
        calls.forEach((c) => {
            if (!c.improvementNote) return;
            const theme = c.weakestParam || '_general';
            if (!themes[theme]) { themes[theme] = []; }
            themes[theme].push(c);
        });
        return Object.keys(themes)
            .map((k) => {
                const rows = themes[k];
                const label = k === '_general'
                    ? 'General coaching'
                    : (METRIC_LABELS[k] || this.formatMetricLabel(k));
                const color = k === '_general' ? '#2563EB' : '#DC2626';
                const base = {
                    key: `${prefix}-${k}`,
                    theme: label,
                    count: rows.length,
                    countLabel: `${rows.length} call${rows.length === 1 ? '' : 's'}`,
                    headStyle: `background:${this.hexToTint(color, 0.1)};border-left:3px solid ${color};`,
                    dotStyle: `background:${color};`
                };
                if (byAgent) {
                    const agents = {};
                    rows.forEach((c) => {
                        const a = c.agentName || 'Unassigned';
                        if (!agents[a]) { agents[a] = []; }
                        agents[a].push(c);
                    });
                    base.byAgent = true;
                    base.agents = Object.keys(agents)
                        .map((a) => {
                            const list = agents[a];
                            return {
                                key: `${prefix}-${k}-${a}`,
                                agent: a,
                                initials: this.initialsOf(a),
                                countLabel: `${list.length}`,
                                notes: list.map((c, i) => ({
                                    key: `${prefix}-${k}-${a}-${i}`,
                                    text: c.improvementNote,
                                    context: c.name
                                }))
                            };
                        })
                        .sort((x, y) => y.notes.length - x.notes.length);
                } else {
                    base.byAgent = false;
                    base.notes = rows.map((c, i) => ({
                        key: `${prefix}-${k}-${i}`,
                        text: c.improvementNote,
                        context: `${c.name} · ${LEAD_TYPE_LABELS[c.leadType] || c.leadType}`
                    }));
                }
                return base;
            })
            .sort((a, b) => b.count - a.count)
            .map((g, i) => {
                // Collapsible: default = only the FIRST group open, rest collapsed.
                // collapsedCoach stores an explicit user override per theme key.
                const override = this.collapsedCoach[g.key];
                const open = override ? override === 'open' : i === 0;
                return {
                    ...g,
                    open,
                    caret: open ? '⌄' : '›',
                    bodyClass: open ? 'mca-coach-body' : 'mca-coach-body mca-coach-collapsed'
                };
            });
    }

    handleCoachToggle(event) {
        const key = event.currentTarget.dataset.key;
        const wasOpen = event.currentTarget.dataset.open === 'true';
        this.collapsedCoach = { ...this.collapsedCoach, [key]: wasOpen ? 'closed' : 'open' };
    }


    /* ============================================================ */
    /*  Shared per-agent computations (used by Team + Scorecard)     */
    /* ============================================================ */
    parameterRowsForCalls(calls) {
        const sums = {};
        const counts = {};
        calls.forEach((c) => {
            const m = c.metrics || {};
            Object.keys(m).forEach((k) => {
                if (m[k] != null) {
                    sums[k] = (sums[k] || 0) + Number(m[k]);
                    counts[k] = (counts[k] || 0) + 1;
                }
            });
        });
        return Object.keys(METRIC_LABELS)
            .filter((k) => counts[k])
            .map((k) => {
                const val = sums[k] / counts[k];
                const pct = Math.round((val / MASTER_SCALE_MAX) * 100);
                let color = '#ba0517';
                if (val >= 4.0) color = '#2e844a';
                else if (val >= 3.0) color = '#fe9339';
                return {
                    key: k,
                    label: METRIC_LABELS[k],
                    _value: val,
                    valueDisplay: `${val.toFixed(2)} / ${MASTER_SCALE_MAX}`,
                    barStyle: `width:${pct}%;background:${color};`
                };
            });
    }

    summaryForCalls(calls) {
        const analyzable = calls.filter((c) => c.analyzable);
        const avg = analyzable.length
            ? analyzable.reduce((s, c) => s + (Number(c.overallScore) || 0), 0) / analyzable.length : 0;
        const pos = calls.filter((c) => c.sentiment === 'Positive').length;
        const fatal = calls.filter((c) => c.isFatal).length;
        return {
            callCount: calls.length,
            avgDisplay: avg.toFixed(2),
            scoreMax: MASTER_SCALE_MAX,
            scoreBadgeClass: this.masterStatusBadge(avg),
            positivePct: calls.length ? Math.round((pos / calls.length) * 100) : 0,
            fatalCount: fatal
        };
    }

    recordRowsForCalls(calls) {
        return calls
            .map((c) => {
                const score = Number(c.overallScore) || 0;
                return {
                    leadId: c.leadId,
                    name: c.name,
                    leadTypeLabel: LEAD_TYPE_LABELS[c.leadType] || c.leadType,
                    scoreDisplay: `${score.toFixed(1)} / ${MASTER_SCALE_MAX}`,
                    statusLabel: c.statusLabel,
                    statusBadgeClass: this.masterStatusBadge(score),
                    sentiment: c.sentiment || 'Neutral',
                    weakest: c.weakestParam ? (METRIC_LABELS[c.weakestParam] || c.weakestParam) : '—',
                    createdDate: c.createdDate
                };
            })
            .sort((a, b) => (b.createdDate || 0) - (a.createdDate || 0));
    }

    /* ============================================================ */
    /*  Tab / screen navigation                                      */
    /* ============================================================ */
    handleTabSelect(event) {
        const screen = event.currentTarget.dataset.screen;
        if (screen) { this.activeScreen = screen; }
    }

    get isAdmin() { return this.activeScreen === 'admin'; }
    get isTeam() { return this.activeScreen === 'tl'; }
    get isAgent() { return this.activeScreen === 'agent'; }
    get isInsights() { return this.activeScreen === 'insights'; }

    // Nav-tab highlight classes
    get tabAdminClass() { return this.isAdmin ? 'nav-tab active' : 'nav-tab'; }
    get tabInsightsClass() { return this.isInsights ? 'nav-tab active' : 'nav-tab'; }
    get tabTeamClass() { return this.isTeam ? 'nav-tab active' : 'nav-tab'; }
    get tabAgentClass() { return this.isAgent ? 'nav-tab active' : 'nav-tab'; }

    /* ============================================================ */
    /*  Small shared helpers                                         */
    /* ============================================================ */
    initialsOf(name) {
        return String(name || '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0].toUpperCase())
            .join('');
    }

    formatMetricLabel(key) {
        return String(key || '')
            .replace(/_/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    }

    getKpiBadgeClass(result) {
        if (result === 'Yes') return 'badge badge-success';
        if (result === 'Partial') return 'badge badge-warning';
        if (result === 'No') return 'badge badge-error';
        return 'badge badge-neutral';
    }

    getCheckMarkClass(result) {
        if (result === 'Yes') return 'check-mark yes';
        if (result === 'Partial') return 'check-mark partial';
        if (result === 'No') return 'check-mark no';
        return 'check-mark partial';
    }

    getCheckMark(result) {
        if (result === 'Yes') return '✓';
        if (result === 'No') return '✗';
        return '~';
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
