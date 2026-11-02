public class de_LeadSelector_v2Controller {

    @AuraEnabled
    public static List<Lead> getLeads() {
        try {
            return [
                SELECT Id, Name, Company, Email, Phone, Status, CreatedDate
                FROM Lead
                WHERE RecordType.Name IN ('Phone Leads', 'FIS', 'AddtoCart')
                ORDER BY CreatedDate DESC
            ];
        } catch (Exception e) {
            throw new AuraHandledException('Error retrieving leads: ' + e.getMessage());
        }
    }
    @AuraEnabled
    public static String startAuditing(String idsString) {
        try {
            ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput =
                        new ConnectApi.EinsteinPromptTemplateGenerationsInput();
                    promptInput.isPreview = false;

                    Map<String, ConnectApi.WrappedValue> valueMap =
                        new Map<String, ConnectApi.WrappedValue>();

                    ConnectApi.WrappedValue wrappedInput = new ConnectApi.WrappedValue();
                    wrappedInput.value = idsString;
                    valueMap.put('Input:leadRecs', wrappedInput);

                    promptInput.inputParams = valueMap;
                    promptInput.additionalConfig =
                        new ConnectApi.EinsteinLlmAdditionalConfigInput();
                    promptInput.additionalConfig.applicationName =
                        'PromptTemplateGenerationsInvocable';

                    ConnectApi.EinsteinPromptTemplateGenerationsRepresentation genOutput =
                        ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(
                            'Master_Call_Analysis',
                            promptInput
                        );

                    // ----- Parse JSON -----
                    String rawText = genOutput.generations[0].text;
                    system.debug('rawText: ' + rawText);

                return rawText;
        } catch (Exception e) {
            throw new AuraHandledException('Error starting audit: ' + e.getMessage());
        }
    }
}
