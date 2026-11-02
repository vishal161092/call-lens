/**
 * Apex Controller for Audio Analysis Dashboard
 * Retrieves Audio_Analysis__c field data from Lead records
 */
public with sharing class de_AudioAnalysisController {

    /**
     * Get Audio Analysis data from Lead record
     * @param leadId The ID of the Lead record
     * @return String JSON data from Audio_Analysis__c field
     */
    @AuraEnabled(cacheable=true)
    public static String getAudioAnalysisData(Id leadId) {
        try {
            if (leadId == null) {
                throw new AuraHandledException('Lead ID is required');
            }

            Lead leadRecord = [
                SELECT Id, Audio_Analysis__c
                FROM Lead
                WHERE Id = :leadId
                LIMIT 1
            ];

            return leadRecord.Audio_Analysis__c;
        } catch (Exception e) {
            throw new AuraHandledException('Error retrieving audio analysis data: ' + e.getMessage());
        }
    }
}
