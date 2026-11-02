/**
 * Apex Controller for Account 360° Derived Intelligence
 * Invokes Einstein Prompt Template to generate account-level derived intelligence
 * and returns JSON in the expected schema.
 */
public with sharing class de_derived_intelligence_account_apex {

    /**
     * Invoke the Account 360 Derived Intelligence prompt and return JSON response.
     * @param accountId The Account (or related record) ID to analyze
     * @return String JSON response with account360DerivedIntelligence and strategicImplications
     */
    @AuraEnabled
    public static String getDerivedIntelligence(Id accountId) {
        try {
            if (accountId == null) {
                throw new AuraHandledException('Account ID is required');
            }


            ConnectApi.EinsteinPromptTemplateGenerationsInput promptGenerationsInput = new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            promptGenerationsInput.isPreview = false;
                            
            Map<String,ConnectApi.WrappedValue> valueMap = new Map<String,ConnectApi.WrappedValue>();

            Map<String, String> DocRecId = new Map<String, String>();
            DocRecId.put('id', accountId); // Opp ID

            ConnectApi.WrappedValue DocRecId_Val = new ConnectApi.WrappedValue();
            DocRecId_Val.value = DocRecId;

            // Map<String, String> FileId = new Map<String, String>();
            // FileId.put('id', cdl.ContentDocumentId); // Opp ID

            // ConnectApi.WrappedValue FileId_Val = new ConnectApi.WrappedValue();
            // FileId_Val.value = FileId;

            // ConnectApi.WrappedValue query = new ConnectApi.WrappedValue();
            // query.value = inputQuery;
                                            
            // valueMap.put('Input:inputQuery', query);
            // valueMap.put('Input:file', FileId_Val);
            valueMap.put('Input:accountRec', DocRecId_Val); 
                                            
            promptGenerationsInput.inputParams = valueMap;
                                            
            promptGenerationsInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            promptGenerationsInput.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';
                                            
            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation generationsOutput = 
            ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate('Derived_Intelligence_for_Account', promptGenerationsInput);
                                            
            System.debug('Prompt resolution: ' + generationsOutput.prompt);
                                            
            System.debug('Prompt response: ' + generationsOutput.generations[0].text);

            return generationsOutput.generations[0].text;
        } catch (Exception e) {
            throw new AuraHandledException('Error generating derived intelligence: ' + e.getMessage());
        }
    }

    /**
     * Return the Name of the given Account record. Used by the dealer catchment
     * card to show the live account name while the rest of the card is static.
     * @param recordId The Account ID
     * @return String the Account Name (null if not found)
     */
    @AuraEnabled(cacheable=true)
    public static String getAccountName(Id recordId) {
        if (recordId == null) {
            return null;
        }
        List<Account> accts = [SELECT Name FROM Account WHERE Id = :recordId LIMIT 1];
        return accts.isEmpty() ? null : accts[0].Name;
    }

}