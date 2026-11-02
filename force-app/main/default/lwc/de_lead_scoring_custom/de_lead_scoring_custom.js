import { LightningElement, api } from 'lwc';
import getLeadScoreJson from '@salesforce/apex/de_lead_scoring_custom_apex.getLeadScoreJson';

export default class DeLeadScoringCustom extends LightningElement {
    _recordId;
    @api get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        this._recordId = value;
        if (value) {
            this.loadLeadScore();
        }
    }

    isLoading = false;
    error = null;
    scoreData = null;

    metricEvaluations = [];
    criteria = {};
    totalScore = 0;
    leadCategory = '';
    overallAssessment = '';
    scoreRange = '';
    topPositives = [];
    earnedPoints = '0';
    possiblePoints = '100';
    pointsSummary = '';
    hasExcludedMetrics = false;

    connectedCallback() {
        if (this._recordId) {
            this.loadLeadScore();
        }
    }

    loadLeadScore() {
        if (!this.recordId) {
            this.error = 'Lead record ID is not available.';
            return;
        }

        this.isLoading = true;
        this.error = null;

        getLeadScoreJson({ leadId: this.recordId })
            .then((rawText) => {
                if (!rawText || !rawText.trim()) {
                    this.error = 'Prompt returned an empty response.';
                    this.scoreData = null;
                    return;
                }

                // Apex returns a wrapper: { promptRaw, criteria }. Older callers may
                // still get the bare prompt JSON, so fall back gracefully.
                let promptRaw = rawText;
                let outerParsed = null;
                try {
                    outerParsed = JSON.parse(rawText);
                } catch (e) {
                    outerParsed = null;
                }
                if (outerParsed && typeof outerParsed === 'object' && 'promptRaw' in outerParsed) {
                    promptRaw = outerParsed.promptRaw;
                    this.criteria = outerParsed.criteria || {};
                } else {
                    this.criteria = {};
                }

                const parsed = this.parsePromptJson(promptRaw);
                this.scoreData = parsed;
                this.processData();
            })
            .catch((err) => {
                this.error = err?.body?.message || err?.message || 'Failed to generate lead score.';
                this.scoreData = null;
            })
            .finally(() => {
                this.isLoading = false;
            });
    }

    parsePromptJson(rawText) {
        let jsonStr = rawText.trim();

        // Support outputs wrapped in markdown fences
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }

        // If model adds preamble text, trim to first/last braces
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }

        return JSON.parse(jsonStr);
    }

    processData() {
        const data = this.scoreData || {};
        const metrics = Array.isArray(data.metricEvaluations) ? data.metricEvaluations : [];

        let weightedSum = 0;
        let applicableWeight = 0;

        this.metricEvaluations = metrics.map((m, index) => {
            const score = Number(m.score) || 0;
            const devName = this.extractDevName(m.metricName);
            const crit = (this.criteria && this.criteria[devName]) || {};
            const weight = Number(crit.weightage) || 0;
            const isApplicable = this.isMetricApplicable(m);

            // "Points earned out of points possible": the weight is the question's
            // maximum point value; the 5-point score is how much of it was earned.
            const earnedPoints = isApplicable ? (weight * score) / 5 : 0;

            // Only applicable metrics with a defined weight contribute to the total.
            if (isApplicable && weight > 0) {
                weightedSum += score * weight;
                applicableWeight += weight;
            }

            const pct = Math.max(0, Math.min(100, (score / 5) * 100));
            const scoreColor = this.getScoreColor(score);
            const cleanMetricName = this.cleanMetricName(m.metricName, index);
            const questionText = this.resolveQuestionText(m, cleanMetricName, crit);
            return {
                key: `metric-${index}`,
                metricName: cleanMetricName,
                questionText,
                score,
                weight,
                isApplicable,
                weightLabel: weight > 0 ? `Weight: ${this.formatNum(weight)}%` : '',
                pointsLabel: isApplicable
                    ? `${this.formatNum(earnedPoints)} / ${this.formatNum(weight)} pts`
                    : 'N/A',
                justification: m.justification || '',
                evidence: m.evidence || '',
                scoreStyle: `color:${scoreColor.text}`,
                progressStyle: `width:${pct}%; background:${scoreColor.bar};`,
                justificationClass: score >= 4 ? 'justification-box high' : score >= 3 ? 'justification-box medium' : 'justification-box low',
                isExpanded: false,
                toggleLabel: 'Show Details',
                toggleIcon: '▼',
                headerClass: score >= 4 ? 'metric-header metric-header-high' : score >= 3 ? 'metric-header metric-header-medium' : 'metric-header metric-header-low',
                icon: this.getMetricIcon(cleanMetricName),
                detailsClass: 'details-container collapsed'
            };
        });

        // Weighted 1-5 average across applicable metrics, normalized to 0-100.
        const rawAvg = applicableWeight > 0 ? weightedSum / applicableWeight : 0;
        this.totalScore = Math.round(rawAvg * 20);
        this.leadCategory = this.deriveCategory(this.totalScore);
        this.overallAssessment = (data.overallAssessment && (data.overallAssessment.summary || data.overallAssessment)) || '';
        this.scoreRange = this.getScoreRange(this.leadCategory);

        // Points-earned rollup. When nothing is NA, possible = 100; when some
        // metric was NA it drops out of both totals, so the label reads out of
        // the points that actually applied (never a silent disappearance).
        const earnedTotal = weightedSum / 5;
        this.earnedPoints = this.formatNum(earnedTotal);
        this.possiblePoints = this.formatNum(applicableWeight);
        this.hasExcludedMetrics = applicableWeight > 0 && applicableWeight < 100;
        this.pointsSummary = `${this.earnedPoints} / ${this.possiblePoints} possible`;

        this.topPositives = this.metricEvaluations
            .filter((m) => m.score >= 4)
            .sort((a, b) => b.score - a.score)
            .map((m, i) => ({
                key: `positive-${i}`,
                text: `${m.metricName} ${m.score}/5`,
                pillClass: m.score >= 5 ? 'positive-pill excellent' : 'positive-pill strong'
            }));
    }

    // Pull the CMDT DeveloperName ("LS1") out of a metricName like "LS1. Buying Intent".
    extractDevName(metricName) {
        const raw = (metricName || '').trim();
        const match = raw.match(/^(LS\s*\d+)/i);
        if (!match) {
            return '';
        }
        return match[1].replace(/\s+/g, '').toUpperCase();
    }

    // A metric is excluded from the weighted total when explicitly marked NA /
    // not applicable (e.g. a signal the transcript never touched).
    isMetricApplicable(metric) {
        const m = metric || {};
        if (m.applicable === false) {
            return false;
        }
        const answer = (m.answer || '').toString().trim().toUpperCase();
        if (answer === 'NA' || answer === 'N/A') {
            return false;
        }
        return true;
    }

    // Trim trailing zeros so 10.8 stays 10.8 but 14.0 shows as 14.
    formatNum(value) {
        const n = Number(value) || 0;
        return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }

    deriveCategory(score) {
        if (score >= 70) {
            return 'Hot';
        }
        if (score >= 40) {
            return 'Warm';
        }
        return 'Cold';
    }

    cleanMetricName(metricName, index) {
        const fallback = `Metric ${index + 1}`;
        const raw = (metricName || fallback).trim();
        // Remove prefixes like LS1., Q2), Q3 -, Q4:
        return raw
            .replace(/^LS\s*\d+\s*[\.\)\:\-]*\s*/i, '')
            .replace(/^Q\s*\d+\s*[\.\)\:\-]*\s*/i, '')
            .trim();
    }

    resolveQuestionText(metric, fallback, crit) {
        const metricData = metric || {};
        if (crit && typeof crit.question === 'string' && crit.question.trim()) {
            return crit.question.trim();
        }
        const candidates = [
            metricData.question,
            metricData.questionText,
            metricData.metricQuestion,
            metricData.criteriaQuestion,
            metricData.promptQuestion,
            metricData.label
        ];

        const firstPopulated = candidates.find((value) => typeof value === 'string' && value.trim());
        if (firstPopulated) {
            return firstPopulated.trim();
        }

        const fallbackText = (fallback || '').trim();
        const normalized = fallbackText.toLowerCase();
        const questionTypeToQuestion = {
            'need depth': 'How urgent/severe is the problem they want to solve?',
            capability: 'Do they have means and authority to move forward?',
            alignment: 'How well does our offering match their stated requirements?',
            engagement: 'How active, curious, and positive was the lead during the call?',
            velocity: 'Did they commit to a clear, timely next step?'
        };

        return questionTypeToQuestion[normalized] || fallbackText;
    }

    getMetricIcon(name) {
        const n = (name || '').toLowerCase();
        if (n.includes('need')) return '🔥';
        if (n.includes('capability')) return '🔑';
        if (n.includes('alignment')) return '🎯';
        if (n.includes('engagement')) return '👥';
        if (n.includes('velocity')) return '🚀';
        return '📊';
    }

    getScoreColor(score) {
        if (score >= 4) {
            return { text: '#16A34A', bar: '#22C55E' };
        }
        if (score >= 3) {
            return { text: '#D97706', bar: '#F59E0B' };
        }
        return { text: '#DC2626', bar: '#EF4444' };
    }

    getScoreRange(category) {
        if (category === 'Hot') {
            return '70-100';
        }
        if (category === 'Warm') {
            return '40-69';
        }
        if (category === 'Cold') {
            return 'Below 40';
        }
        return 'N/A';
    }

    get categoryBadgeClass() {
        const c = (this.leadCategory || '').toLowerCase();
        if (c === 'hot') return 'category-badge hot';
        if (c === 'cold') return 'category-badge cold';
        return 'category-badge warm';
    }

    get totalScoreCircleClass() {
        const c = (this.leadCategory || '').toLowerCase();
        if (c === 'hot') return 'score-circle hot';
        if (c === 'cold') return 'score-circle cold';
        return 'score-circle warm';
    }

    get hasData() {
        return !!this.scoreData && !this.error && !this.isLoading;
    }

    get positiveCount() {
        return this.topPositives.length;
    }

    handleToggleMetric(event) {
        const metricKey = event.currentTarget.dataset.key;
        this.metricEvaluations = this.metricEvaluations.map((metric) => {
            if (metric.key !== metricKey) {
                return metric;
            }
            const isExpanded = !metric.isExpanded;
            return {
                ...metric,
                isExpanded,
                toggleLabel: isExpanded ? 'Hide Details' : 'Show Details',
                toggleIcon: isExpanded ? '▲' : '▼',
                detailsClass: isExpanded ? 'details-container expanded' : 'details-container collapsed'
            };
        });
    }
}