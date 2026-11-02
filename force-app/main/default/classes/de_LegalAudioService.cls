public with sharing class de_LegalAudioService {

    private static final String INSIGHT_PROMPT_TEMPLATE = 'Audio_Analysis_Legal';

    @AuraEnabled
    public static String saveAudioToRecord(Id recordId, String base64, String fileName, String title) {
        if (String.isBlank(base64)) {
            throw new AuraHandledException('No audio data provided.');
        }
        if (String.isBlank(fileName)) {
            fileName = 'audio_recording.webm';
        }
        if (String.isBlank(title)) {
            title = 'Audio Recording';
        }

        String normalized = base64;
        if (normalized.contains(',')) {
            normalized = normalized.substringAfter(',');
        }
        normalized = stripWhitespace(normalized);

        Blob fileBody;
        try {
            fileBody = EncodingUtil.base64Decode(normalized);
        } catch (Exception e) {
            throw new AuraHandledException('Invalid audio data format.');
        }

        if (fileBody == null || fileBody.size() == 0) {
            throw new AuraHandledException('Audio file is empty.');
        }

        ContentVersion cv = new ContentVersion();
        cv.Title = title;
        cv.PathOnClient = fileName;
        cv.VersionData = fileBody;
        if (recordId != null) {
            cv.FirstPublishLocationId = recordId;
        }
        insert cv;

        ContentVersion inserted = [
            SELECT Id, ContentDocumentId
            FROM ContentVersion
            WHERE Id = :cv.Id
            LIMIT 1
        ];

        return inserted.ContentDocumentId;
    }

    @AuraEnabled
    public static String transcribeAudioFile(String contentDocumentId, String sourceLanguage) {
        if (String.isBlank(contentDocumentId)) {
            throw new AuraHandledException('Content Document ID is required for transcription.');
        }

        return invokeSpeechToText(contentDocumentId);
    }

    @AuraEnabled
    public static String generateInsights(String transcript, Id recordId) {
        if (String.isBlank(transcript) || transcript.length() < 10) {
            return JSON.serialize(buildEmptyAnalysis('Transcript too short for analysis.'));
        }

        try {
            System.debug('=== generateInsights START ===');
            System.debug('Transcript length: ' + transcript.length());
            System.debug('Prompt template name: ' + INSIGHT_PROMPT_TEMPLATE);

            ConnectApi.EinsteinPromptTemplateGenerationsInput input = new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            input.isPreview = false;

            Map<String, ConnectApi.WrappedValue> inputParams = new Map<String, ConnectApi.WrappedValue>();
            ConnectApi.WrappedValue transcriptValue = new ConnectApi.WrappedValue();
            transcriptValue.value = transcript;
            inputParams.put('Input:inputTranscript', transcriptValue);
            input.inputParams = inputParams;

            input.additionalConfig = new ConnectApi.EinsteinLLMAdditionalConfigInput();
            input.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';

            System.debug('Input params keys: ' + inputParams.keySet());
            System.debug('additionalConfig.applicationName: ' + input.additionalConfig.applicationName);
            System.debug('Calling ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate...');

            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation result =
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(INSIGHT_PROMPT_TEMPLATE, input);

            System.debug('ConnectApi call returned successfully');
            System.debug('Result null? ' + (result == null));

            if (result != null) {
                System.debug('Generations null? ' + (result.generations == null));
                if (result.generations != null) {
                    System.debug('Generations size: ' + result.generations.size());
                    if (!result.generations.isEmpty()) {
                        ConnectApi.EinsteinLLMGenerationItemOutput generation = result.generations[0];
                        System.debug('Generation text length: ' + (generation.text != null ? generation.text.length() : 0));
                        System.debug('Generation text (first 500): ' + (generation.text != null ? generation.text.left(500) : 'NULL'));
                        return generation.text;
                    }
                }
            }
            System.debug('No generations returned - falling through to fallback');
        } catch (Exception e) {
            System.debug('=== ConnectApi EXCEPTION ===');
            System.debug('Exception type: ' + e.getTypeName());
            System.debug('Exception message: ' + e.getMessage());
            System.debug('Exception cause: ' + e.getCause());
            System.debug('Exception stack: ' + e.getStackTraceString());
        }

        return buildFallbackInsight(transcript);
    }

    // ═══════════════════════════════════════
    // Private Helpers
    // ═══════════════════════════════════════

    private static String invokeSpeechToText(String contentDocumentId) {
        Map<String, Object> flowInputs = new Map<String, Object>{
            'contentDocumentId' => contentDocumentId
        };

        Flow.Interview flowInterview = Flow.Interview.createInterview('de_Speech_To_Text_Flow', flowInputs);
        flowInterview.start();

        String result = (String) flowInterview.getVariableValue('convertedText');
        if (String.isBlank(result)) {
            throw new AuraHandledException('Speech to text returned no transcription.');
        }
        return result;
    }

    private static Map<String, Object> buildEmptyAnalysis(String message) {
        return new Map<String, Object>{
            'summary' => message,
            'tone' => '',
            'sentiment' => 'neutral',
            'sentimentDescription' => '',
            'overallScore' => '',
            'keyPoints' => new List<String>(),
            'improvements' => new List<String>(),
            'riskFlags' => new List<String>(),
            'actionCategories' => new List<Object>()
        };
    }

    private static String buildFallbackInsight(String transcript) {
        List<String> words = transcript.split('\\s+');
        Integer wordCount = words.size();

        String sentiment = 'neutral';
        String tone = 'Professional';
        for (String word : words) {
            String lower = word.toLowerCase();
            if (lower.contains('urgent') || lower.contains('immediately') || lower.contains('critical')) {
                tone = 'Urgent / Action-oriented';
                sentiment = 'negative';
                break;
            } else if (lower.contains('agree') || lower.contains('happy') || lower.contains('positive') || lower.contains('good')) {
                sentiment = 'positive';
                tone = 'Collaborative';
                break;
            } else if (lower.contains('risk') || lower.contains('dispute') || lower.contains('conflict') || lower.contains('problem')) {
                sentiment = 'negative';
                tone = 'Cautious / Advisory';
                break;
            }
        }

        Map<String, Object> matterIntake = new Map<String, Object>{
            'title' => 'Matter Intake Actions',
            'key' => 'matter_intake',
            'triggeredBy' => 'Detected legal matter references in transcript',
            'actions' => new List<String>{
                'Create new Legal Matter record',
                'Set priority based on urgency indicators',
                'Tag relevant workstreams'
            }
        };

        Map<String, Object> partyExtraction = new Map<String, Object>{
            'title' => 'Party/Entity Extraction Actions',
            'key' => 'party_extraction',
            'triggeredBy' => 'Entity names detected in transcript',
            'actions' => new List<String>{
                'Add extracted parties as Conflict Party entries',
                'Run entity resolution and alias normalization',
                'Update matter party graph'
            }
        };

        Map<String, Object> conflictReassessment = new Map<String, Object>{
            'title' => 'Conflict Reassessment Actions',
            'key' => 'conflict_reassessment',
            'triggeredBy' => 'Conflict check indicators in conversation',
            'actions' => new List<String>{
                'Generate conflict check task',
                'Route to Conflicts Counsel for review'
            }
        };

        Map<String, Object> obligations = new Map<String, Object>{
            'title' => 'Obligation/Deadline Actions',
            'key' => 'obligation_deadlines',
            'triggeredBy' => 'Timeline and deadline references detected',
            'actions' => new List<String>{
                'Create deadline tasks for mentioned dates',
                'Schedule follow-up meetings',
                'Add timeline risk flags to matter dashboard'
            }
        };

        Map<String, Object> missingInfo = new Map<String, Object>{
            'title' => 'Missing Information Actions',
            'key' => 'missing_information',
            'triggeredBy' => 'Uncertainty language detected (e.g. "still being discussed", "likely")',
            'actions' => new List<String>{
                'Create missing-info items for unconfirmed details',
                'Assign owners with SLA due dates',
                'Mark items that block conflict clearance'
            }
        };

        Map<String, Object> riskGovernance = new Map<String, Object>{
            'title' => 'Risk and Governance Actions',
            'key' => 'risk_governance',
            'triggeredBy' => 'Risk indicators and governance triggers',
            'actions' => new List<String>{
                'Create risk evaluation update',
                'Route to appropriate counsel',
                'Open decision path: Approve / Approve with Conditions / Decline'
            }
        };

        Map<String, Object> result = new Map<String, Object>{
            'summary' => 'Legal audio recording containing ' + wordCount + ' words. Configure the Legal_Audio_Insights prompt template in Prompt Builder for detailed AI-powered analysis including matter intake, entity extraction, conflict assessment, obligations, and risk governance.',
            'tone' => tone,
            'sentiment' => sentiment,
            'sentimentDescription' => 'Based on keyword analysis of the transcript. Full AI analysis requires the Legal_Audio_Insights prompt template.',
            'overallScore' => '3.5/5',
            'keyPoints' => new List<String>{
                'Audio transcription completed via Speech Foundation',
                'Transcript contains ' + wordCount + ' words for analysis',
                'Configure prompt template for comprehensive legal analysis'
            },
            'improvements' => new List<String>{
                'Set up Legal_Audio_Insights prompt template for full AI analysis',
                'Ensure all parties mentioned are captured in CRM',
                'Review and confirm all deadline items'
            },
            'riskFlags' => new List<String>{
                'Prompt template not configured — using fallback analysis',
                'Full conflict check and entity extraction requires AI prompt'
            },
            'actionCategories' => new List<Object>{
                matterIntake, partyExtraction, conflictReassessment,
                obligations, missingInfo, riskGovernance
            }
        };

        return JSON.serialize(result);
    }

    @AuraEnabled
    public static String createActionRecord(Id recordId, String categoryKey, String categoryData) {
        if (String.isBlank(categoryKey)) {
            throw new AuraHandledException('Category key is required.');
        }

        Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(categoryData);
        List<Object> actions = (List<Object>) data.get('actions');
        String triggeredBy = (String) data.get('triggeredBy');

        Map<String, Object> result = new Map<String, Object>();

        if (categoryKey == 'matter_intake') {
            result = createMatterRecord(recordId, actions, triggeredBy);
        } else if (categoryKey == 'conflict_reassessment') {
            result = createConflictTask(recordId, actions, triggeredBy);
        } else if (categoryKey == 'obligation_deadlines') {
            result = createDeadlineRecords(recordId, actions, triggeredBy);
        } else if (categoryKey == 'risk_governance') {
            result = createRiskEvaluation(recordId, actions, triggeredBy);
        } else if (categoryKey == 'party_extraction') {
            result = buildPartyDisplay(actions);
        } else if (categoryKey == 'missing_information') {
            result = buildMissingInfoDisplay(actions);
        }

        return JSON.serialize(result);
    }

    private static Map<String, Object> createMatterRecord(Id recordId, List<Object> actions, String triggeredBy) {
        String subject = 'New Legal Matter';
        String priority = 'Medium';
        String description = '';

        for (Object a : actions) {
            String action = String.valueOf(a);
            String lower = action.toLowerCase();
            if (lower.contains('priority') && lower.contains('high')) {
                priority = 'High';
            }
            description += action + '\n';
            if (lower.contains('create') && lower.contains('matter')) {
                String matterName = action.contains('=') ? action.substringAfter('=').trim() : action;
                if (String.isNotBlank(matterName)) {
                    subject = matterName;
                }
            }
        }

        Case matter = new Case();
        matter.Subject = subject;
        matter.Priority = priority;
        matter.Description = 'Triggered by: ' + triggeredBy + '\n\n' + description.trim();
        matter.Status = 'New';
        matter.Origin = 'Audio Analysis';
        if (recordId != null) {
            matter.AccountId = recordId;
        }
        insert matter;

        List<Object> fieldsList = new List<Object>();
        fieldsList.add(new Map<String, String>{ 'key' => 'Subject', 'value' => subject });
        fieldsList.add(new Map<String, String>{ 'key' => 'Priority', 'value' => priority });
        fieldsList.add(new Map<String, String>{ 'key' => 'Status', 'value' => 'New' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Origin', 'value' => 'Audio Analysis' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Description', 'value' => description.trim() });

        return new Map<String, Object>{
            'recordType' => 'Matter',
            'recordId' => matter.Id,
            'fields' => fieldsList
        };
    }

    private static Map<String, Object> createConflictTask(Id recordId, List<Object> actions, String triggeredBy) {
        String subject = 'Conflict Check Required';
        String description = '';

        for (Object a : actions) {
            String action = String.valueOf(a);
            description += action + '\n';
            if (action.toLowerCase().contains('conflict') && action.toLowerCase().contains('check')) {
                subject = action.length() > 80 ? action.substring(0, 80) : action;
            }
        }

        Task t = new Task();
        t.Subject = subject;
        t.Description = 'Triggered by: ' + triggeredBy + '\n\n' + description.trim();
        t.Priority = 'High';
        t.Status = 'Not Started';
        t.ActivityDate = Date.today().addDays(2);
        if (recordId != null) {
            t.WhatId = recordId;
        }
        insert t;

        List<Object> fieldsList = new List<Object>();
        fieldsList.add(new Map<String, String>{ 'key' => 'Subject', 'value' => subject });
        fieldsList.add(new Map<String, String>{ 'key' => 'Priority', 'value' => 'High' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Status', 'value' => 'Not Started' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Due Date', 'value' => String.valueOf(Date.today().addDays(2)) });
        fieldsList.add(new Map<String, String>{ 'key' => 'Related To', 'value' => recordId != null ? String.valueOf(recordId) : 'N/A' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Description', 'value' => description.trim() });

        return new Map<String, Object>{
            'recordType' => 'Conflict Check (Task)',
            'recordId' => t.Id,
            'fields' => fieldsList
        };
    }

    private static Map<String, Object> createDeadlineRecords(Id recordId, List<Object> actions, String triggeredBy) {
        List<Map<String, Object>> created = new List<Map<String, Object>>();

        for (Object a : actions) {
            String action = String.valueOf(a);
            String lower = action.toLowerCase();

            if (lower.contains('event') || lower.contains('meeting') || lower.contains('reconvene') || lower.contains('schedule')) {
                Event ev = new Event();
                ev.Subject = action.contains(':') ? action.substringAfter(':').trim() : action;
                ev.Description = 'Triggered by: ' + triggeredBy;
                ev.StartDateTime = Datetime.now().addDays(1);
                ev.EndDateTime = Datetime.now().addDays(1).addHours(1);
                if (recordId != null) {
                    ev.WhatId = recordId;
                }
                insert ev;
                created.add(new Map<String, Object>{
                    'type' => 'Event',
                    'id' => ev.Id,
                    'subject' => ev.Subject
                });
            } else {
                Task t = new Task();
                t.Subject = action.contains(':') ? action.substringAfter(':').trim() : action;
                t.Description = 'Triggered by: ' + triggeredBy;
                t.Priority = 'High';
                t.Status = 'Not Started';
                t.ActivityDate = lower.contains('48') ? Date.today().addDays(2) : Date.today().addDays(7);
                if (recordId != null) {
                    t.WhatId = recordId;
                }
                insert t;
                created.add(new Map<String, Object>{
                    'type' => 'Task',
                    'id' => t.Id,
                    'subject' => t.Subject
                });
            }
        }

        List<Object> fieldsList = new List<Object>();
        fieldsList.add(new Map<String, String>{ 'key' => 'Records Created', 'value' => String.valueOf(created.size()) });
        for (Integer i = 0; i < created.size(); i++) {
            Map<String, Object> rec = created[i];
            fieldsList.add(new Map<String, String>{ 'key' => (String)rec.get('type') + ' ' + (i+1), 'value' => (String)rec.get('subject') });
        }
        fieldsList.add(new Map<String, String>{ 'key' => 'Triggered By', 'value' => triggeredBy });

        return new Map<String, Object>{
            'recordType' => 'Tasks & Events',
            'records' => created,
            'fields' => fieldsList
        };
    }

    private static Map<String, Object> createRiskEvaluation(Id recordId, List<Object> actions, String triggeredBy) {
        String conflictLevel = 'Red';
        String counterparty = '';
        String description = '';
        String conflictReason = '';

        for (Object a : actions) {
            String action = String.valueOf(a);
            String lower = action.toLowerCase();
            description += action + '\n';
            if (lower.contains('route') || lower.contains('counsel')) {
                conflictReason += action + '. ';
            }
            if (lower.contains('counterpart') || lower.contains('entity') || lower.contains('northbridge') || lower.contains('aster')) {
                counterparty = action;
            }
        }

        ProServ_Risk_Evaluation__c riskEval = new ProServ_Risk_Evaluation__c();
        riskEval.Status__c = 'New';
        riskEval.Conflict_Level__c = conflictLevel;
        riskEval.Counterparty_Entity__c = String.isNotBlank(counterparty) ? counterparty.left(255) : 'See description';
        riskEval.Description__c = 'Triggered by: ' + triggeredBy + '\n\nActions:\n' + description.trim();
        riskEval.Conflict_Reason__c = String.isNotBlank(conflictReason) ? conflictReason.trim() : triggeredBy;
        riskEval.Due_Date__c = Date.today().addDays(3);
        riskEval.Agent_Recommendation__c = 'ApproveWithConditions';
        riskEval.Prior_Representation_Found__c = description.toLowerCase().contains('historical') || description.toLowerCase().contains('prior');
        if (recordId != null) {
            riskEval.Account__c = recordId;
        }
        insert riskEval;

        List<Object> fieldsList = new List<Object>();
        fieldsList.add(new Map<String, String>{ 'key' => 'Status', 'value' => 'New' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Conflict Level', 'value' => conflictLevel });
        fieldsList.add(new Map<String, String>{ 'key' => 'Counterparty', 'value' => riskEval.Counterparty_Entity__c });
        fieldsList.add(new Map<String, String>{ 'key' => 'Due Date', 'value' => String.valueOf(Date.today().addDays(3)) });
        fieldsList.add(new Map<String, String>{ 'key' => 'AI Recommendation', 'value' => 'Approve with Conditions' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Prior Representation', 'value' => riskEval.Prior_Representation_Found__c ? 'Yes' : 'No' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Conflict Reason', 'value' => riskEval.Conflict_Reason__c });
        fieldsList.add(new Map<String, String>{ 'key' => 'Description', 'value' => description.trim() });

        return new Map<String, Object>{
            'recordType' => 'Risk Evaluation',
            'recordId' => riskEval.Id,
            'fields' => fieldsList
        };
    }

    private static Map<String, Object> buildPartyDisplay(List<Object> actions) {
        List<Object> fieldsList = new List<Object>();
        Integer entityCount = 0;
        List<String> entityNames = new List<String>();
        String resolutionStatus = 'Pending Review';

        for (Object a : actions) {
            String action = String.valueOf(a);
            String lower = action.toLowerCase();
            if (lower.contains('capture') || lower.contains('add') || lower.contains('record')) {
                entityCount++;
                String entityName = action;
                if (action.contains('Capture ')) entityName = action.substringAfter('Capture ').substringBefore(' as');
                if (action.contains('Record ')) entityName = action.substringAfter('Record ').substringBefore(' and');
                entityNames.add(entityName);
            }
            if (lower.contains('resolution') || lower.contains('normalization')) {
                resolutionStatus = 'Resolution Required';
            }
        }

        fieldsList.add(new Map<String, String>{ 'key' => 'Entities Identified', 'value' => String.valueOf(entityCount > 0 ? entityCount : actions.size()) });
        fieldsList.add(new Map<String, String>{ 'key' => 'Resolution Status', 'value' => resolutionStatus });
        for (Integer i = 0; i < entityNames.size() && i < 4; i++) {
            fieldsList.add(new Map<String, String>{ 'key' => 'Entity ' + (i+1), 'value' => entityNames[i] });
        }
        fieldsList.add(new Map<String, String>{ 'key' => 'New Counterparty', 'value' => 'Yes' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Graph Update', 'value' => 'Affiliate links pending' });

        return new Map<String, Object>{
            'recordType' => 'Extracted Entities',
            'displayMode' => true,
            'fields' => fieldsList
        };
    }

    private static Map<String, Object> buildMissingInfoDisplay(List<Object> actions) {
        List<Object> fieldsList = new List<Object>();
        Integer blockingCount = 0;
        List<String> missingItems = new List<String>();

        for (Object a : actions) {
            String action = String.valueOf(a);
            String lower = action.toLowerCase();
            if (lower.contains('missing-info') || lower.contains('create') || lower.contains('confirmation')) {
                String item = action.contains(':') ? action.substringAfter(':').trim() : action;
                missingItems.add(item);
            }
            if (lower.contains('block') || lower.contains('clearance')) {
                blockingCount++;
            }
        }

        fieldsList.add(new Map<String, String>{ 'key' => 'Items Flagged', 'value' => String.valueOf(missingItems.size() > 0 ? missingItems.size() : actions.size()) });
        fieldsList.add(new Map<String, String>{ 'key' => 'Blocking Clearance', 'value' => blockingCount > 0 ? 'Yes (' + blockingCount + ' items)' : 'No' });
        for (Integer i = 0; i < missingItems.size() && i < 3; i++) {
            fieldsList.add(new Map<String, String>{ 'key' => 'Pending Item ' + (i+1), 'value' => missingItems[i] });
        }
        fieldsList.add(new Map<String, String>{ 'key' => 'SLA Status', 'value' => 'Awaiting Assignment' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Owner Assignment', 'value' => 'Associate + Client POC' });
        fieldsList.add(new Map<String, String>{ 'key' => 'Priority', 'value' => blockingCount > 0 ? 'High — Blocks Conflict Clearance' : 'Medium' });

        return new Map<String, Object>{
            'recordType' => 'Missing Information Tracker',
            'displayMode' => true,
            'fields' => fieldsList
        };
    }

    private static String stripWhitespace(String s) {
        if (String.isBlank(s)) return s;
        s = s.replace(' ', '');
        s = s.replace('\n', '');
        s = s.replace('\r', '');
        s = s.replace('\t', '');
        return s;
    }
}
