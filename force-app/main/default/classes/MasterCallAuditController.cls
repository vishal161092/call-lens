/**
 * MasterCallAuditController
 * ----------------------------------------------------------------------------
 * Aggregates per-call AI analysis (Lead.Audio_Analysis__c) across many Leads,
 * entirely in Apex — NO LLM in this path. This is the engine behind the master
 * call-audit dashboard and scales to hundreds/thousands of records without the
 * Einstein gateway timeout that the Master_Call_Analysis prompt hit at ~4 records.
 *
 * Drill hierarchy: Date range -> Lead Type (journey) -> Agent -> individual call.
 * The same filter args progressively narrow the same result set.
 *
 * Scores are read natively on the 1-5 scale stored in qualityScores. Averages
 * are rounded to 2 dp; per-call overall to 1 dp (to match de_audioAnalysisDashboard).
 */
public with sharing class MasterCallAuditController {

    // The six quality dimensions, in display order.
    private static final List<String> METRIC_KEYS = new List<String>{
        'tone', 'compliance', 'empathy', 'resolutionQuality', 'brandAdherence', 'mandatoryDisclosures'
    };

    @AuraEnabled(cacheable=true)
    public static MasterAudit getMasterAudit(String startDate, String endDate, String leadType, String agentName) {
        MasterAudit result = new MasterAudit();

        List<Lead> leads = queryLeads(startDate, endDate, leadType, agentName);
        if (leads.isEmpty()) {
            return result; // empty shell — LWC renders an empty state
        }

        // Running accumulators
        Integer analyzableCount = 0;
        Integer fatalCount = 0;
        Decimal overallSum = 0;
        Map<String, Decimal> metricSum = new Map<String, Decimal>();
        Map<String, Integer> metricCount = new Map<String, Integer>();
        for (String m : METRIC_KEYS) { metricSum.put(m, 0); metricCount.put(m, 0); }

        Map<String, Integer> sentimentMix = new Map<String, Integer>{
            'Positive' => 0, 'Neutral' => 0, 'Negative' => 0
        };
        Map<String, Integer> distribution = new Map<String, Integer>{
            'exceptional' => 0, 'excellent' => 0, 'good' => 0, 'fair' => 0, 'needsImprovement' => 0
        };

        Map<String, GroupAgg> byType = new Map<String, GroupAgg>();
        Map<String, GroupAgg> byAgent = new Map<String, GroupAgg>();

        // KPI-question adherence: applicable / yes / partial counts + score sum, keyed on question text.
        Map<String, Integer> kpiApplicable = new Map<String, Integer>();
        Map<String, Integer> kpiYes = new Map<String, Integer>();
        Map<String, Integer> kpiPartial = new Map<String, Integer>();
        Map<String, Decimal> kpiScoreSum = new Map<String, Decimal>();
        Map<String, Integer> kpiScoreCount = new Map<String, Integer>();
        List<String> kpiOrder = new List<String>();

        // Sentiment trajectory (start -> end within the call).
        Map<String, Integer> sentimentShift = new Map<String, Integer>{
            'improved' => 0, 'held' => 0, 'declined' => 0
        };

        // Keyword mining accumulators — term -> total / positive-context / negative-context counts.
        Map<String, Integer> kwTotal = new Map<String, Integer>();
        Map<String, Integer> kwPos = new Map<String, Integer>();
        Map<String, Integer> kwNeg = new Map<String, Integer>();

        for (Lead ld : leads) {
            CallRow row = parseCall(ld);
            if (row == null) { continue; }
            result.calls.add(row);

            // Aggregate KPI evaluations (not stored on CallRow — too heavy per row).
            if (row.kpiEvals != null) {
                for (KpiEval ke : row.kpiEvals) {
                    if (String.isBlank(ke.question) || !ke.applicable) { continue; }
                    if (!kpiApplicable.containsKey(ke.question)) {
                        kpiApplicable.put(ke.question, 0);
                        kpiYes.put(ke.question, 0);
                        kpiPartial.put(ke.question, 0);
                        kpiScoreSum.put(ke.question, 0);
                        kpiScoreCount.put(ke.question, 0);
                        kpiOrder.add(ke.question);
                    }
                    kpiApplicable.put(ke.question, kpiApplicable.get(ke.question) + 1);
                    if (ke.verdict == 'yes') { kpiYes.put(ke.question, kpiYes.get(ke.question) + 1); }
                    else if (ke.verdict == 'partial') { kpiPartial.put(ke.question, kpiPartial.get(ke.question) + 1); }
                    if (ke.score != null) {
                        kpiScoreSum.put(ke.question, kpiScoreSum.get(ke.question) + ke.score);
                        kpiScoreCount.put(ke.question, kpiScoreCount.get(ke.question) + 1);
                    }
                }
            }

            // Voice-of-customer keyword mining — from what the CUSTOMER actually said.
            // Objection turns -> negative context; Intent/Resolution/Closing turns in a
            // positive-sentiment call -> positive context. Both feed the brand cloud.
            if (row.highlights != null) {
                for (Highlight h : row.highlights) {
                    if (String.isBlank(h.speaker) || !h.speaker.toLowerCase().contains('cust')) { continue; }
                    Boolean isNeg = h.tag == 'Objection';
                    Boolean isPos = !isNeg && row.sentiment == 'Positive'
                        && (h.tag == 'Intent' || h.tag == 'Resolution' || h.tag == 'Closing');
                    mineKeywords(h.text, isPos, isNeg, kwTotal, kwPos, kwNeg);
                }
            }

            // Sentiment trajectory
            Integer s0 = sentimentRank(row.sentimentStart);
            Integer s1 = sentimentRank(row.sentimentEnd);
            if (s0 != null && s1 != null) {
                if (s1 > s0) { sentimentShift.put('improved', sentimentShift.get('improved') + 1); }
                else if (s1 < s0) { sentimentShift.put('declined', sentimentShift.get('declined') + 1); }
                else { sentimentShift.put('held', sentimentShift.get('held') + 1); }
            }

            // Grouping keys (fall back to a readable label when blank)
            String typeKey = String.isBlank(ld.Lead_Type__c) ? 'Unspecified' : ld.Lead_Type__c;
            String agentKey = String.isBlank(ld.Agent_Name__c) ? 'Unassigned' : ld.Agent_Name__c;

            GroupAgg gType = byType.get(typeKey);
            if (gType == null) { gType = new GroupAgg(typeKey); byType.put(typeKey, gType); }
            GroupAgg gAgent = byAgent.get(agentKey);
            if (gAgent == null) { gAgent = new GroupAgg(agentKey); byAgent.put(agentKey, gAgent); }

            gType.add(row);
            gAgent.add(row);

            if (row.isFatal) { fatalCount++; }
            if (sentimentMix.containsKey(row.sentiment)) {
                sentimentMix.put(row.sentiment, sentimentMix.get(row.sentiment) + 1);
            }

            if (row.analyzable) {
                analyzableCount++;
                overallSum += row.overallScore;
                distribution.put(row.statusBucket, distribution.get(row.statusBucket) + 1);
                for (String m : METRIC_KEYS) {
                    Decimal v = row.metrics.get(m);
                    if (v != null) {
                        metricSum.put(m, metricSum.get(m) + v);
                        metricCount.put(m, metricCount.get(m) + 1);
                    }
                }
            }
        }

        // Summary
        result.summary.totalCalls = result.calls.size();
        result.summary.analyzableCalls = analyzableCount;
        result.summary.fatalCount = fatalCount;
        result.summary.averageOverallScore = analyzableCount > 0
            ? (overallSum / analyzableCount).setScale(2, System.RoundingMode.HALF_UP) : 0;
        result.summary.sentimentMix = sentimentMix;
        result.summary.scoreDistribution = distribution;

        // Score by parameter (org/level averages)
        for (String m : METRIC_KEYS) {
            Decimal avg = metricCount.get(m) > 0
                ? (metricSum.get(m) / metricCount.get(m)).setScale(2, System.RoundingMode.HALF_UP) : 0;
            result.scoreByParameter.put(m, avg);
        }

        // Finalize groups
        for (GroupAgg g : byType.values()) { result.byLeadType.add(g.toSummary()); }
        for (GroupAgg g : byAgent.values()) { result.byAgent.add(g.toSummary()); }

        // KPI adherence — per applicable question: Yes / Partial / No split, avg score, met-rate.
        for (String q : kpiOrder) {
            Integer app = kpiApplicable.get(q);
            if (app == null || app == 0) { continue; }
            KpiAdherence ka = new KpiAdherence();
            ka.question = q;
            ka.applicableCount = app;
            ka.yesCount = kpiYes.get(q);
            ka.partialCount = kpiPartial.get(q);
            ka.noCount = app - ka.yesCount - ka.partialCount;
            // "Met" credits a full Yes as 1 and a Partial as 0.5 — the honest middle.
            ka.metRate = (((Decimal) ka.yesCount + (Decimal) ka.partialCount / 2) / app * 100)
                .setScale(0, System.RoundingMode.HALF_UP);
            ka.avgScore = kpiScoreCount.get(q) > 0
                ? (kpiScoreSum.get(q) / kpiScoreCount.get(q)).setScale(1, System.RoundingMode.HALF_UP) : 0;
            result.kpiAdherence.add(ka);
        }

        // Sentiment trajectory totals (start -> end within each call).
        result.sentimentShift = sentimentShift;

        // Voice-of-customer keyword cards, ranked from the mined maps.
        result.negativeTriggers = rankKeywords(kwNeg, kwTotal, kwPos, kwNeg, 12, 'neg');
        result.positiveDrivers = rankKeywords(kwPos, kwTotal, kwPos, kwNeg, 12, 'pos');
        result.brandKeywords = rankKeywords(kwTotal, kwTotal, kwPos, kwNeg, 22, 'all');

        return result;
    }

    /* ===================== Keyword mining ===================== */

    // Words too common / noisy to carry meaning — dropped before counting.
    private static final Set<String> STOPWORDS = new Set<String>{
        // function words
        'the','and','was','are','for','you','your','with','that','this','have','has','had',
        'not','but','she','him','her','his','they','them','their','our','out','can','will',
        'would','could','should','from','about','were','been','being','into','over','than',
        'then','there','here','what','when','where','which','who','why','how','all','any',
        'some','more','most','such','only','also','just','very','too','one','two','get','got',
        'did','does','done','say','said','tell','told','ask','asked','know','knew','want','need',
        'call','called','calling','phone','sir','madam','okay','yeah','yes','yah','hello','hmm',
        'thank','thanks','please','sure','right','well','like','because','still','now','back',
        'come','came','went','going','make','made','take','took','give','gave','put','see','saw',
        'let','may','might','must','shall','its','it','is','am','be','do','no','so','if','of',
        'on','in','to','at','as','an','or','by','up','we','me','my','he','i','a','customer','agent',
        // contraction fragments (apostrophe split leaves these)
        'don','dont','doesn','didn','isn','wasn','aren','arent','cant','wont','couldn','wouldn',
        'shouldn','hasn','haven','won','ain','ill','ive','youre','theyre','thats','whats','lets',
        // conversational filler / generic verbs
        'way','thing','things','lot','bit','actually','basically','fine','good','great','sorry',
        'mean','maybe','something','anything','everything','someone','anyone','little','again',
        'much','many','look','looking','give','using','used','use','around','really','anyway',
        // time / number words (not brand signal)
        'today','tomorrow','yesterday','morning','evening','afternoon','night','week','weeks',
        'month','months','day','days','year','years','time','times','soon','later','minute','minutes',
        'three','four','five','six','seven','eight','nine','ten','eleven','twelve','twenty','thirty',
        'forty','fifty','hundred','thousand','first','second','third','next','last',
        // common romanized-Hindi tokens that leak through
        'hai','hain','nahi','nahin','kya','aap','mein','main','hoga','hogi','karenge','karunga',
        'bataunga','bataenge','filhaal','abhi','theek','accha','achha','haan','koi','kuch','bhi',
        'toh','gaya','gayi','raha','rahe','rahi','kar','karo','karke','wala','wale','wali','yeh',
        'woh','voh','matlab','bola','bolo','sahi','thoda','zyada','baat','samajh'
    };

    /**
     * Tokenise one highlight into unigrams + adjacent bigrams and add them to the
     * running keyword maps. Devanagari/other scripts fall away (we split on ASCII
     * letters only), so only the LLM-normalised English survives — clean by design.
     */
    private static void mineKeywords(String text, Boolean isPos, Boolean isNeg,
            Map<String, Integer> total, Map<String, Integer> pos, Map<String, Integer> neg) {
        if (String.isBlank(text)) { return; }
        String[] raw = text.toLowerCase().split('[^a-z]+');
        List<String> toks = new List<String>();
        for (String w : raw) {
            if (w.length() >= 3 && !STOPWORDS.contains(w)) { toks.add(w); }
        }
        List<String> terms = new List<String>();
        terms.addAll(toks);
        for (Integer i = 0; i < toks.size() - 1; i++) {
            if (toks[i] == toks[i + 1]) { continue; } // skip repeated-word artefacts ("same same")
            terms.add(toks[i] + ' ' + toks[i + 1]); // bigram phrase
        }
        for (String t : terms) {
            total.put(t, (total.containsKey(t) ? total.get(t) : 0) + 1);
            if (isPos) { pos.put(t, (pos.containsKey(t) ? pos.get(t) : 0) + 1); }
            if (isNeg) { neg.put(t, (neg.containsKey(t) ? neg.get(t) : 0) + 1); }
        }
    }

    /**
     * Rank a keyword map, dropping unigrams already covered by a higher-ranked
     * bigram (so "making charges" wins over a bare "charges"). Returns the top N.
     */
    private static List<KeywordItem> rankKeywords(Map<String, Integer> source,
            Map<String, Integer> total, Map<String, Integer> pos, Map<String, Integer> neg,
            Integer limitN, String mode) {
        // Sort terms by their count in the source map, descending.
        List<String> keys = new List<String>(source.keySet());
        for (Integer i = 0; i < keys.size(); i++) {
            for (Integer j = i + 1; j < keys.size(); j++) {
                if (source.get(keys[j]) > source.get(keys[i])) {
                    String tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
                }
            }
        }
        Set<String> covered = new Set<String>();
        List<KeywordItem> chosen = new List<KeywordItem>();
        // First pass: multi-word phrases (they win over their component words).
        for (Boolean phrasePass : new List<Boolean>{ true, false }) {
            for (String k : keys) {
                if (chosen.size() >= limitN) { break; }
                Boolean isPhrase = k.contains(' ');
                if (isPhrase != phrasePass) { continue; }
                if (covered.contains(k)) { continue; }
                // Drop hapax noise — a term must recur to earn a slot.
                if (source.get(k) < 2) { continue; }
                Integer pc = pos.containsKey(k) ? pos.get(k) : 0;
                Integer nc = neg.containsKey(k) ? neg.get(k) : 0;
                // Context dominance: a "driver" must skew positive, a "trigger" negative.
                if (mode == 'pos' && pc < nc) { continue; }
                if (mode == 'neg' && nc < pc) { continue; }
                KeywordItem ki = new KeywordItem();
                ki.term = k;
                ki.count = total.containsKey(k) ? total.get(k) : source.get(k);
                ki.posCount = pc;
                ki.negCount = nc;
                chosen.add(ki);
                covered.add(k);
                if (isPhrase) {
                    for (String part : k.split(' ')) { covered.add(part); }
                }
            }
        }
        return chosen;
    }

    /**
     * Fetch one Lead's raw Audio_Analysis__c JSON for the master drill-down's
     * individual-analysis (L3) view. The aggregation CallRow deliberately omits
     * KPIs/strengths/summary to stay light across hundreds of rows; this pulls the
     * full blob for a single record on demand.
     */
    @AuraEnabled(cacheable=true)
    public static String getCallAnalysis(Id leadId) {
        if (leadId == null) { return null; }
        List<Lead> leads = [
            SELECT Id, Audio_Analysis__c
            FROM Lead
            WHERE Id = :leadId
            WITH USER_MODE
            LIMIT 1
        ];
        if (leads.isEmpty()) { return null; }
        return leads[0].Audio_Analysis__c;
    }

    /**
     * Media companion for the individual-analysis view: the real call transcript
     * (Lead.Audio_Transcription__c) plus a streamable URL for the MP3 recording
     * linked to the Lead (latest MP3/WAV/M4A ContentVersion, if any). Both are
     * real — no fabricated data. Returns null members when absent.
     */
    @AuraEnabled(cacheable=true)
    public static CallMedia getCallMedia(Id leadId) {
        CallMedia media = new CallMedia();
        if (leadId == null) { return media; }

        List<Lead> leads = [
            SELECT Id, Audio_Transcription__c
            FROM Lead WHERE Id = :leadId WITH USER_MODE LIMIT 1
        ];
        if (!leads.isEmpty()) {
            media.transcript = leads[0].Audio_Transcription__c;
        }

        // Find the audio recording linked to this Lead (most recent audio file).
        Set<Id> docIds = new Set<Id>();
        for (ContentDocumentLink cdl : [
            SELECT ContentDocumentId FROM ContentDocumentLink
            WHERE LinkedEntityId = :leadId
        ]) {
            docIds.add(cdl.ContentDocumentId);
        }
        if (!docIds.isEmpty()) {
            List<ContentVersion> versions = [
                SELECT Id, FileExtension, Title, CreatedDate
                FROM ContentVersion
                WHERE ContentDocumentId IN :docIds
                  AND IsLatest = true
                  AND FileType IN ('MP3', 'WAV', 'M4A')
                ORDER BY CreatedDate DESC
            ];
            if (!versions.isEmpty()) {
                // Shepherd download endpoint streams the file to an <audio> tag
                // for authenticated users of this org.
                media.audioUrl = '/sfc/servlet.shepherd/version/download/' + versions[0].Id;
                media.audioTitle = versions[0].Title;
            }
        }
        return media;
    }

    public class CallMedia {
        @AuraEnabled public String transcript;
        @AuraEnabled public String audioUrl;
        @AuraEnabled public String audioTitle;
    }

    /**
     * The set of GENERIC ("Common") KPI questions defined in
     * Conversation_Lead_Type_KPIs__mdt. Every other question in the metadata is
     * tied to a specific journey (FIS / AddtoCart / Wedding / Wishlist), so any
     * evaluated KPI question NOT in this set is treated as lead-type-specific.
     * Lets the call view split KPIs into a type-specific main bucket + a generic
     * sub-bucket without hardcoding the question text.
     */
    @AuraEnabled(cacheable=true)
    public static List<String> getGenericKpiQuestions() {
        List<String> questions = new List<String>();
        for (Conversation_Lead_Type_KPIs__mdt m : [
            SELECT KPI_Question__c
            FROM Conversation_Lead_Type_KPIs__mdt
            WHERE Lead_Type__c = 'Common'
        ]) {
            if (String.isNotBlank(m.KPI_Question__c)) { questions.add(m.KPI_Question__c); }
        }
        return questions;
    }

    // Canonical QA-scorecard category order (from the Common Audit parameters).
    private static final List<String> RUBRIC_ORDER = new List<String>{
        'Script Adherence', 'Call Etiquette', 'Sales', 'Product & Process', 'Documentation'
    };
    private static final Map<String, String> RUBRIC_ICONS = new Map<String, String>{
        'Script Adherence' => '📜', 'Call Etiquette' => '☎️', 'Sales' => '💰',
        'Product & Process' => '🧩', 'Documentation' => '📝'
    };
    // Business-critical sub-parameters (a miss is a fatal/critical breach). Matched
    // on the exact Common KPI question text.
    private static final Set<String> CRITICAL_QUESTIONS = new Set<String>{
        'remained polite and professional throughout the call',
        'closed the sale with lead info by referring to store or relevant stakeholder',
        'provided complete and correct resolution/information (comprehension displayed)',
        'case/task created accurately in salesforce'
    };

    /**
     * Per-AGENT rubric compliance across ALL of that agent's analysed calls — the
     * QA scorecard (5 categories / 18 Common sub-parameters) rolled up from every
     * call's kpiEvaluations[]. Each sub-parameter carries a real average score, a
     * met-rate compliance %, and a date-ordered sparkline of its running met-rate
     * (plotted on Call_Date__c). Categories/weights/criticality come from
     * Conversation_Lead_Type_KPIs__mdt (Lead_Type__c = 'Common'). No LLM, no fabrication.
     */
    @AuraEnabled(cacheable=true)
    public static AgentRubric getAgentRubric(String agentName, String startDate, String endDate) {
        AgentRubric result = new AgentRubric();
        result.agentName = agentName;
        if (String.isBlank(agentName)) { return result; }

        // 1) Build the Common question -> {category, weight} map from the CMDT.
        //    Category is encoded in Conversation_Parameters__c as "<Category> group. ...".
        Map<String, RubricSub> defByQuestion = new Map<String, RubricSub>();     // lower(question) -> def
        Map<String, List<RubricSub>> defsByCat = new Map<String, List<RubricSub>>();
        for (Conversation_Lead_Type_KPIs__mdt m : [
            SELECT KPI_Question__c, Conversation_Parameters__c, Weightage__c
            FROM Conversation_Lead_Type_KPIs__mdt
            WHERE Lead_Type__c = 'Common'
        ]) {
            if (String.isBlank(m.KPI_Question__c)) { continue; }
            String cat = 'Other';
            if (String.isNotBlank(m.Conversation_Parameters__c)
                    && m.Conversation_Parameters__c.contains(' group.')) {
                cat = m.Conversation_Parameters__c.substringBefore(' group.').trim();
            }
            RubricSub def = new RubricSub();
            def.question = m.KPI_Question__c;
            def.weight = m.Weightage__c != null ? m.Weightage__c.intValue() : 0;
            def.critical = CRITICAL_QUESTIONS.contains(m.KPI_Question__c.toLowerCase());
            def.category = cat;
            defByQuestion.put(m.KPI_Question__c.toLowerCase(), def);
            if (!defsByCat.containsKey(cat)) { defsByCat.put(cat, new List<RubricSub>()); }
            defsByCat.get(cat).add(def);
        }

        // 2) Aggregate this agent's calls: per question, collect date-ordered verdicts.
        List<Lead> leads = queryLeads(startDate, endDate, null, agentName);
        Map<String, List<RubricPoint>> pointsByQ = new Map<String, List<RubricPoint>>();
        Integer callCount = 0;
        for (Lead ld : leads) {
            CallRow row = parseCall(ld);
            if (row == null) { continue; }
            callCount++;
            if (row.kpiEvals == null) { continue; }
            for (KpiEval ke : row.kpiEvals) {
                if (String.isBlank(ke.question)) { continue; }
                String qk = ke.question.toLowerCase();
                if (!defByQuestion.containsKey(qk)) { continue; } // only Common QA questions
                if (!ke.applicable || ke.verdict == 'na') { continue; }
                if (!pointsByQ.containsKey(qk)) { pointsByQ.put(qk, new List<RubricPoint>()); }
                RubricPoint p = new RubricPoint();
                p.callDate = row.callDate;
                p.verdict = ke.verdict;
                p.score = ke.score;
                pointsByQ.get(qk).add(p);
            }
        }
        result.callCount = callCount;

        // 3) Build categories in canonical order, sub-params by weight desc.
        Decimal overallWSum = 0, overallWeight = 0;
        for (String cat : RUBRIC_ORDER) {
            if (!defsByCat.containsKey(cat)) { continue; }
            RubricCategory rc = new RubricCategory();
            rc.name = cat;
            rc.icon = RUBRIC_ICONS.get(cat);
            rc.categoryNumber = RUBRIC_ORDER.indexOf(cat) + 1;

            List<RubricSub> defs = defsByCat.get(cat);
            // sort by weight desc, then question text
            for (Integer i = 0; i < defs.size(); i++) {
                for (Integer j = i + 1; j < defs.size(); j++) {
                    Boolean swap = defs[j].weight > defs[i].weight
                        || (defs[j].weight == defs[i].weight && defs[j].question < defs[i].question);
                    if (swap) { RubricSub t = defs[i]; defs[i] = defs[j]; defs[j] = t; }
                }
            }

            Decimal catWSum = 0, catWeight = 0;
            Integer sub = 0;
            for (RubricSub def : defs) {
                sub++;
                RubricSub s = new RubricSub();
                s.code = rc.categoryNumber + '.' + sub;
                s.question = def.question;
                s.weight = def.weight;
                s.critical = def.critical;
                s.category = cat;
                rc.weight += def.weight;

                List<RubricPoint> pts = pointsByQ.get(def.question.toLowerCase());
                if (pts != null && !pts.isEmpty()) {
                    // order by call date ascending for the sparkline
                    pts.sort();
                    Integer yes = 0, partial = 0, scoreN = 0;
                    Decimal scoreSum = 0;
                    Decimal cumYes = 0, cumPartial = 0;
                    for (Integer k = 0; k < pts.size(); k++) {
                        RubricPoint p = pts[k];
                        if (p.verdict == 'yes') { yes++; cumYes++; }
                        else if (p.verdict == 'partial') { partial++; cumPartial += 0.5; }
                        if (p.score != null) { scoreSum += p.score; scoreN++; }
                        // running met-rate at this point in time
                        Decimal running = ((cumYes + cumPartial) / (k + 1) * 100).setScale(0, System.RoundingMode.HALF_UP);
                        s.spark.add(running);
                    }
                    s.applicable = true;
                    s.applicableCount = pts.size();
                    s.compliance = (((Decimal) yes + (Decimal) partial / 2) / pts.size() * 100)
                        .setScale(0, System.RoundingMode.HALF_UP);
                    s.avgScore = scoreN > 0 ? (scoreSum / scoreN).setScale(1, System.RoundingMode.HALF_UP) : 0;
                    catWSum += s.compliance * def.weight;
                    catWeight += def.weight;
                }
                rc.subParams.add(s);
            }
            rc.compliance = catWeight > 0 ? (catWSum / catWeight).setScale(0, System.RoundingMode.HALF_UP) : null;
            if (catWeight > 0) { overallWSum += catWSum; overallWeight += catWeight; }
            result.categories.add(rc);
        }

        // Weakest category (lowest compliance among those with data) drives the callout.
        Decimal worst = null; RubricCategory worstCat = null;
        for (RubricCategory rc : result.categories) {
            if (rc.compliance != null && (worst == null || rc.compliance < worst)) {
                worst = rc.compliance; worstCat = rc;
            }
        }
        if (worstCat != null) { worstCat.isWeakest = true; }
        result.overallCompliance = overallWeight > 0
            ? (overallWSum / overallWeight).setScale(0, System.RoundingMode.HALF_UP) : 0;

        return result;
    }

    public class AgentRubric {
        @AuraEnabled public String agentName;
        @AuraEnabled public Integer callCount = 0;
        @AuraEnabled public Decimal overallCompliance = 0;
        @AuraEnabled public List<RubricCategory> categories = new List<RubricCategory>();
    }

    public class RubricCategory {
        @AuraEnabled public String name;
        @AuraEnabled public String icon;
        @AuraEnabled public Integer categoryNumber;
        @AuraEnabled public Integer weight = 0;      // sum of sub-parameter weights
        @AuraEnabled public Decimal compliance;      // weighted met-rate %, null when no data
        @AuraEnabled public Boolean isWeakest = false;
        @AuraEnabled public List<RubricSub> subParams = new List<RubricSub>();
    }

    public class RubricSub {
        @AuraEnabled public String code;             // "2.4"
        @AuraEnabled public String question;
        @AuraEnabled public Integer weight = 0;
        @AuraEnabled public Boolean critical = false;
        @AuraEnabled public Boolean applicable = false;
        @AuraEnabled public Integer applicableCount = 0;
        @AuraEnabled public Decimal avgScore = 0;    // mean 1-5 across scored calls
        @AuraEnabled public Decimal compliance = 0;  // met-rate %
        @AuraEnabled public List<Decimal> spark = new List<Decimal>(); // running met-rate over time
        // category is used only server-side while grouping.
        public String category;
    }

    /** One date-stamped verdict for a sub-parameter, used to build the sparkline. */
    private class RubricPoint implements Comparable {
        Datetime callDate;
        String verdict;
        Decimal score;
        public Integer compareTo(Object o) {
            RubricPoint other = (RubricPoint) o;
            if (this.callDate == null && other.callDate == null) { return 0; }
            if (this.callDate == null) { return -1; }
            if (other.callDate == null) { return 1; }
            if (this.callDate < other.callDate) { return -1; }
            if (this.callDate > other.callDate) { return 1; }
            return 0;
        }
    }

    private static List<Lead> queryLeads(String startDate, String endDate, String leadType, String agentName) {
        // Audio_Analysis__c is a long text area and cannot be filtered in SOQL;
        // gate on the Lead_Analysis_Check__c flag instead and null-guard the blob in code.
        String soql = 'SELECT Id, Name, Agent_Name__c, Lead_Type__c, Status, CreatedDate, Call_Date__c, Audio_Analysis__c '
            + 'FROM Lead WHERE Lead_Analysis_Check__c = true';

        Map<String, Object> binds = new Map<String, Object>();
        if (String.isNotBlank(startDate)) {
            soql += ' AND CreatedDate >= :startDt';
            binds.put('startDt', Datetime.newInstanceGmt(Date.valueOf(startDate), Time.newInstance(0,0,0,0)));
        }
        if (String.isNotBlank(endDate)) {
            soql += ' AND CreatedDate <= :endDt';
            binds.put('endDt', Datetime.newInstanceGmt(Date.valueOf(endDate), Time.newInstance(23,59,59,0)));
        }
        if (String.isNotBlank(leadType)) {
            soql += ' AND Lead_Type__c = :lt';
            binds.put('lt', leadType);
        }
        if (String.isNotBlank(agentName)) {
            soql += ' AND Agent_Name__c = :an';
            binds.put('an', agentName);
        }
        soql += ' ORDER BY CreatedDate DESC LIMIT 2000';

        return Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE);
    }

    /** Parse one Lead's Audio_Analysis__c JSON into a thin, typed row. */
    private static CallRow parseCall(Lead ld) {
        CallRow row = new CallRow();
        row.leadId = ld.Id;
        row.name = ld.Name;
        row.agentName = String.isBlank(ld.Agent_Name__c) ? 'Unassigned' : ld.Agent_Name__c;
        row.leadType = String.isBlank(ld.Lead_Type__c) ? 'Unspecified' : ld.Lead_Type__c;
        row.status = ld.Status;
        row.createdDate = ld.CreatedDate;
        // Actual call timestamp powers the daily trend; fall back to record creation
        // when a lead has no call date recorded yet.
        row.callDate = ld.Call_Date__c != null ? ld.Call_Date__c : ld.CreatedDate;

        if (String.isBlank(ld.Audio_Analysis__c)) { return null; }

        Map<String, Object> data;
        try {
            data = (Map<String, Object>) JSON.deserializeUntyped(ld.Audio_Analysis__c);
        } catch (Exception e) {
            return null; // malformed JSON — skip from aggregation
        }
        if (data == null) { return null; }

        // Quality scores -> metrics map + overall
        row.metrics = new Map<String, Decimal>();
        Object qsObj = data.get('qualityScores');
        Decimal sum = 0; Integer n = 0;
        if (qsObj instanceof Map<String, Object>) {
            Map<String, Object> qs = (Map<String, Object>) qsObj;
            for (String m : METRIC_KEYS) {
                Decimal v = extractScore(qs.get(m));
                row.metrics.put(m, v);
                if (v != null) { sum += v; n++; }
            }
        }
        row.overallScore = n > 0 ? (sum / n).setScale(1, System.RoundingMode.HALF_UP) : 0;
        row.statusBucket = bucketFor(row.overallScore);
        row.statusLabel = labelFor(row.overallScore);

        // AI insights
        Object aiObj = data.get('aiInsights');
        row.sentiment = 'Neutral';
        row.analyzable = true;
        row.isFatal = false;
        if (aiObj instanceof Map<String, Object>) {
            Map<String, Object> ai = (Map<String, Object>) aiObj;
            if (ai.get('sentiment') != null) { row.sentiment = String.valueOf(ai.get('sentiment')); }
            // "customerIntent" is a per-call sentence; "intentCategory" is the short bucket
            // (e.g. "Availability / Inventory") that the Overview intent chart aggregates on.
            if (ai.get('customerIntent') != null) { row.customerIntent = String.valueOf(ai.get('customerIntent')); }
            if (ai.get('intentCategory') != null) { row.intentCategory = String.valueOf(ai.get('intentCategory')); }
            if (ai.get('journey') != null) { row.journey = String.valueOf(ai.get('journey')); }
            if (ai.get('analyzable') instanceof Boolean) { row.analyzable = (Boolean) ai.get('analyzable'); }
            Object fe = ai.get('fatalError');
            if (fe instanceof Map<String, Object>) {
                Map<String, Object> feMap = (Map<String, Object>) fe;
                Object isFatal = feMap.get('isFatal');
                if (isFatal instanceof Boolean) { row.isFatal = (Boolean) isFatal; }
                // Fatal reason powers the "fatal interactions by type" chart (empty when none flagged).
                if (row.isFatal && feMap.get('reason') != null) {
                    row.fatalReason = String.valueOf(feMap.get('reason'));
                }
            }
            // First scope-of-improvement note — powers the coaching feed in Business Insights.
            Object soi = ai.get('scopeOfImprovement');
            if (soi instanceof List<Object>) {
                List<Object> notes = (List<Object>) soi;
                if (!notes.isEmpty() && notes[0] != null) {
                    row.improvementNote = String.valueOf(notes[0]);
                }
            }
            // Sentiment trajectory: overall opening vs closing sentiment of the call.
            Object sd = ai.get('sentimentDetail');
            if (sd instanceof Map<String, Object>) {
                Map<String, Object> sdMap = (Map<String, Object>) sd;
                if (sdMap.get('start') != null) { row.sentimentStart = String.valueOf(sdMap.get('start')); }
                if (sdMap.get('end') != null) { row.sentimentEnd = String.valueOf(sdMap.get('end')); }
            }
        }

        // KPI evaluations: per-call pass/fail on each scored question (aggregated in caller).
        Object kpiObj = data.get('kpiEvaluations');
        if (kpiObj instanceof List<Object>) {
            row.kpiEvals = new List<KpiEval>();
            for (Object o : (List<Object>) kpiObj) {
                if (!(o instanceof Map<String, Object>)) { continue; }
                Map<String, Object> km = (Map<String, Object>) o;
                KpiEval ke = new KpiEval();
                if (km.get('kpiQuestion') != null) { ke.question = String.valueOf(km.get('kpiQuestion')); }
                // Skip analyzer placeholder rows that carry no real question.
                if (String.isBlank(ke.question)
                    || ke.question.containsIgnoreCase('No KPI questions provided')
                    || ke.question.trim().equalsIgnoreCase('KPI Question:')) { continue; }
                // "applicable" may be a Boolean or a Yes/No string.
                Object ap = km.get('applicable');
                if (ap instanceof Boolean) { ke.applicable = (Boolean) ap; }
                else if (ap != null) { ke.applicable = isYes(String.valueOf(ap)); }
                else { ke.applicable = true; } // absent = treat as scored
                // Answer is one of Yes / Partial / No / NA — map to a verdict.
                ke.verdict = verdictOf(km.get('answer') == null ? '' : String.valueOf(km.get('answer')));
                ke.score = extractScore(km.get('score'));
                if (ke.verdict == 'na') { ke.applicable = false; }
                if (String.isNotBlank(ke.question)) { row.kpiEvals.add(ke); }
            }
        }

        // Conversation highlights (speaker / tag / text) — the mining source for the
        // customer voice-of-customer keyword cards. Kept off the client payload.
        Object thObj = data.get('timelineHighlights');
        if (thObj instanceof List<Object>) {
            row.highlights = new List<Highlight>();
            for (Object o : (List<Object>) thObj) {
                if (!(o instanceof Map<String, Object>)) { continue; }
                Map<String, Object> hm = (Map<String, Object>) o;
                Highlight h = new Highlight();
                if (hm.get('speaker') != null) { h.speaker = String.valueOf(hm.get('speaker')); }
                if (hm.get('tag') != null) { h.tag = String.valueOf(hm.get('tag')); }
                if (hm.get('text') != null) { h.text = String.valueOf(hm.get('text')); }
                if (String.isNotBlank(h.text)) { row.highlights.add(h); }
            }
        }

        // Weakest metric (for the agent table "weakest parameter" column)
        String weakest; Decimal weakestVal;
        for (String m : METRIC_KEYS) {
            Decimal v = row.metrics.get(m);
            if (v != null && (weakestVal == null || v < weakestVal)) { weakestVal = v; weakest = m; }
        }
        row.weakestParam = weakest;
        row.weakestParamScore = weakestVal;

        return row;
    }

    /** qualityScores entries are objects like {"score":4,"justification":"..."}; also tolerate a bare number. */
    private static Decimal extractScore(Object entry) {
        if (entry == null) { return null; }
        if (entry instanceof Map<String, Object>) {
            Object s = ((Map<String, Object>) entry).get('score');
            if (s == null) { return null; }
            return Decimal.valueOf(String.valueOf(s));
        }
        try { return Decimal.valueOf(String.valueOf(entry)); } catch (Exception e) { return null; }
    }

    /** Rank a sentiment word for start-vs-end comparison; null when unrecognised. */
    private static Integer sentimentRank(String s) {
        if (String.isBlank(s)) { return null; }
        String v = s.toLowerCase();
        if (v.contains('positive')) { return 2; }
        if (v.contains('neutral')) { return 1; }
        if (v.contains('negative')) { return 0; }
        return null;
    }

    /** Affirmative test for the applicable flag when it arrives as a string. */
    private static Boolean isYes(String s) {
        if (String.isBlank(s)) { return false; }
        String v = s.trim().toLowerCase();
        return v == 'yes' || v == 'y' || v == 'true' || v == 'applicable';
    }

    /** Map a KPI answer (Yes / Partial / No / NA) to a normalised verdict. */
    private static String verdictOf(String s) {
        if (String.isBlank(s)) { return 'no'; }
        String v = s.trim().toLowerCase();
        if (v == 'yes' || v == 'y' || v == 'pass' || v == 'passed' || v == 'true') { return 'yes'; }
        if (v == 'partial' || v == 'partially') { return 'partial'; }
        if (v == 'na' || v == 'n/a' || v == 'not applicable') { return 'na'; }
        return 'no';
    }

    private static String bucketFor(Decimal score) {
        if (score >= 4.5) { return 'exceptional'; }
        if (score >= 4.0) { return 'excellent'; }
        if (score >= 3.0) { return 'good'; }
        if (score >= 2.0) { return 'fair'; }
        return 'needsImprovement';
    }

    private static String labelFor(Decimal score) {
        if (score >= 4.5) { return 'Exceptional'; }
        if (score >= 4.0) { return 'Excellent'; }
        if (score >= 3.0) { return 'Good'; }
        if (score >= 2.0) { return 'Fair'; }
        return 'Needs Improvement';
    }

    // ===================== Wrapper types =====================

    public class MasterAudit {
        @AuraEnabled public Summary summary = new Summary();
        @AuraEnabled public Map<String, Decimal> scoreByParameter = new Map<String, Decimal>();
        @AuraEnabled public List<GroupSummary> byLeadType = new List<GroupSummary>();
        @AuraEnabled public List<GroupSummary> byAgent = new List<GroupSummary>();
        @AuraEnabled public List<CallRow> calls = new List<CallRow>();
        // Voice-of-customer panels derived from the per-call blob.
        @AuraEnabled public List<KpiAdherence> kpiAdherence = new List<KpiAdherence>();
        @AuraEnabled public Map<String, Integer> sentimentShift = new Map<String, Integer>();
        // Keyword cards mined from what the CUSTOMER actually said (timelineHighlights).
        @AuraEnabled public List<KeywordItem> positiveDrivers = new List<KeywordItem>();
        @AuraEnabled public List<KeywordItem> negativeTriggers = new List<KeywordItem>();
        @AuraEnabled public List<KeywordItem> brandKeywords = new List<KeywordItem>();
    }

    /** One mined term/phrase from customer speech, with its pos/neg context split. */
    public class KeywordItem {
        @AuraEnabled public String term;
        @AuraEnabled public Integer count = 0;     // total mentions
        @AuraEnabled public Integer posCount = 0;  // mentions in a positive context
        @AuraEnabled public Integer negCount = 0;  // mentions in an objection / negative context
    }

    /** Aggregate adherence for one KPI question across all applicable calls. */
    public class KpiAdherence {
        @AuraEnabled public String question;
        @AuraEnabled public Integer applicableCount = 0;
        @AuraEnabled public Integer yesCount = 0;
        @AuraEnabled public Integer partialCount = 0;
        @AuraEnabled public Integer noCount = 0;
        @AuraEnabled public Decimal metRate = 0;   // Yes + 0.5*Partial, as %
        @AuraEnabled public Decimal avgScore = 0;  // mean 1-5 across scored calls
    }

    public class Summary {
        @AuraEnabled public Integer totalCalls = 0;
        @AuraEnabled public Integer analyzableCalls = 0;
        @AuraEnabled public Integer fatalCount = 0;
        @AuraEnabled public Decimal averageOverallScore = 0;
        @AuraEnabled public Map<String, Integer> sentimentMix = new Map<String, Integer>();
        @AuraEnabled public Map<String, Integer> scoreDistribution = new Map<String, Integer>();
    }

    public class GroupSummary {
        @AuraEnabled public String key;
        @AuraEnabled public Integer count = 0;
        @AuraEnabled public Decimal avgScore = 0;
        @AuraEnabled public Integer fatalCount = 0;
        @AuraEnabled public String weakestParam;
        @AuraEnabled public Integer positiveCount = 0;
    }

    public class CallRow {
        @AuraEnabled public Id leadId;
        @AuraEnabled public String name;
        @AuraEnabled public String agentName;
        @AuraEnabled public String leadType;
        @AuraEnabled public String status;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public Datetime callDate;
        @AuraEnabled public Decimal overallScore = 0;
        @AuraEnabled public String statusBucket;
        @AuraEnabled public String statusLabel;
        @AuraEnabled public Map<String, Decimal> metrics = new Map<String, Decimal>();
        @AuraEnabled public String sentiment;
        @AuraEnabled public String customerIntent;
        @AuraEnabled public String intentCategory;
        @AuraEnabled public String improvementNote;
        @AuraEnabled public String fatalReason;
        @AuraEnabled public String journey;
        @AuraEnabled public Boolean analyzable = true;
        @AuraEnabled public Boolean isFatal = false;
        @AuraEnabled public String weakestParam;
        @AuraEnabled public Decimal weakestParamScore;
        // Start/end sentiment for the trajectory panel (small — safe to serialize).
        @AuraEnabled public String sentimentStart;
        @AuraEnabled public String sentimentEnd;
        // Full KPI Q&A list — used only for Apex aggregation, deliberately NOT
        // @AuraEnabled so it never bloats the per-row payload sent to the LWC.
        public List<KpiEval> kpiEvals;
        // Tagged, speaker-attributed conversation highlights — used only for the
        // Apex keyword mining below; NOT @AuraEnabled (kept off the client payload).
        public List<Highlight> highlights;
    }

    /** One entry of timelineHighlights[] — the English, tagged, speaker-attributed turn. */
    public class Highlight {
        String speaker;
        String tag;
        String text;
    }

    /** One row of the per-call kpiEvaluations[] array, distilled for aggregation. */
    public class KpiEval {
        String question;
        Boolean applicable = false;
        String verdict;   // 'yes' | 'partial' | 'no'
        Decimal score;    // 1-5, null when not scored
    }

    /** Mutable accumulator used while grouping; converts to GroupSummary at the end. */
    private class GroupAgg {
        String key;
        Integer count = 0;
        Integer analyzable = 0;
        Decimal scoreSum = 0;
        Integer fatalCount = 0;
        Integer positiveCount = 0;
        Map<String, Decimal> metricSum = new Map<String, Decimal>();
        Map<String, Integer> metricCount = new Map<String, Integer>();

        GroupAgg(String key) {
            this.key = key;
            for (String m : METRIC_KEYS) { metricSum.put(m, 0); metricCount.put(m, 0); }
        }

        void add(CallRow row) {
            count++;
            if (row.isFatal) { fatalCount++; }
            if (row.sentiment == 'Positive') { positiveCount++; }
            if (row.analyzable) {
                analyzable++;
                scoreSum += row.overallScore;
                for (String m : METRIC_KEYS) {
                    Decimal v = row.metrics.get(m);
                    if (v != null) {
                        metricSum.put(m, metricSum.get(m) + v);
                        metricCount.put(m, metricCount.get(m) + 1);
                    }
                }
            }
        }

        GroupSummary toSummary() {
            GroupSummary g = new GroupSummary();
            g.key = key;
            g.count = count;
            g.fatalCount = fatalCount;
            g.positiveCount = positiveCount;
            g.avgScore = analyzable > 0 ? (scoreSum / analyzable).setScale(2, System.RoundingMode.HALF_UP) : 0;
            // weakest average metric for this group
            String weakest; Decimal weakestVal;
            for (String m : METRIC_KEYS) {
                if (metricCount.get(m) > 0) {
                    Decimal avg = metricSum.get(m) / metricCount.get(m);
                    if (weakestVal == null || avg < weakestVal) { weakestVal = avg; weakest = m; }
                }
            }
            g.weakestParam = weakest;
            return g;
        }
    }
}
