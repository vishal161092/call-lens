/**
 * Apex controller for custom lead scoring.
 * Reads Lead.Audio_Transcription__c and invokes Prompt Template.
 */
public with sharing class de_lead_scoring_custom_apex {

    private static final String PROMPT_TEMPLATE_ID = 'Lead_Scoring_Prompt';

    @AuraEnabled
    public static String getLeadScoreJson(Id leadId) {
        try {
            if (leadId == null) {
                throw new AuraHandledException('Lead ID is required.');
            }

            Lead leadRecord = [
                SELECT Id, Audio_Transcription__c
                FROM Lead
                WHERE Id = :leadId
                LIMIT 1
            ];

            if (String.isBlank(leadRecord.Audio_Transcription__c)) {
                throw new AuraHandledException('Audio transcription is empty on this Lead.');
            }

            String rawOutput = invokePrompt(leadRecord.Audio_Transcription__c);

            // Wrap the prompt output together with the scoring criteria (weights +
            // question type) so the LWC has a single source of truth for weights.
            Map<String, Object> payload = new Map<String, Object>{
                'promptRaw' => rawOutput,
                'criteria' => getScoringCriteria()
            };
            return JSON.serialize(payload);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error generating lead score: ' + e.getMessage());
        }
    }

    /**
     * Returns the lead-scoring criteria keyed by CMDT DeveloperName (e.g. "LS1"),
     * which matches the prefix the Lead_Scoring_Questions flow injects into each
     * metricName ("LS1. Buying Intent"). The LWC uses these weights to compute the
     * weighted 0-100 score deterministically instead of trusting an LLM total.
     */
    private static Map<String, Object> getScoringCriteria() {
        Map<String, Object> criteria = new Map<String, Object>();
        for (Lead_Scoring_Criteria__mdt c : [
            SELECT DeveloperName, Question__c, Question_Type__c, Weightage__c
            FROM Lead_Scoring_Criteria__mdt
        ]) {
            criteria.put(c.DeveloperName, new Map<String, Object>{
                'question' => c.Question__c,
                'questionType' => c.Question_Type__c,
                'weightage' => c.Weightage__c
            });
        }
        return criteria;
    }

    private static String invokePrompt(String transcription) {
        List<String> inputKeysToTry = new List<String>{
            'Input:transcriptionData'
        };

        Exception lastException;
        for (String inputKey : inputKeysToTry) {
            try {
                ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput =
                    new ConnectApi.EinsteinPromptTemplateGenerationsInput();
                promptInput.isPreview = false;

                Map<String, ConnectApi.WrappedValue> valueMap = new Map<String, ConnectApi.WrappedValue>();
                ConnectApi.WrappedValue wrappedInput = new ConnectApi.WrappedValue();
                wrappedInput.value = transcription;
                valueMap.put(inputKey, wrappedInput);

                promptInput.inputParams = valueMap;
                promptInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
                promptInput.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';

                ConnectApi.EinsteinPromptTemplateGenerationsRepresentation genOutput =
                    ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(PROMPT_TEMPLATE_ID, promptInput);

                if (genOutput == null || genOutput.generations == null || genOutput.generations.isEmpty()) {
                    throw new AuraHandledException('Prompt returned no generations.');
                }

                return genOutput.generations[0].text;
            } catch (Exception e) {
                lastException = e;
            }
        }

        throw new AuraHandledException(
            'Prompt invocation failed for all known input keys. Last error: ' +
            (lastException == null ? 'Unknown error' : lastException.getMessage())
        );
    }
}
