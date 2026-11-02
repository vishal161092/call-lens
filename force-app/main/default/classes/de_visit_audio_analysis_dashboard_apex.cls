/**
 * Apex Controller for Visit Audio Analysis Dashboard
 * Retrieves Audio_Analysis__c field data from Visit records
 */
public with sharing class de_visit_audio_analysis_dashboard_apex {
    
    /**
     * Get Audio Analysis data from Visit record
     * @param visitId The ID of the Visit record
     * @return String JSON data from Audio_Analysis__c field
     */
    @AuraEnabled(cacheable=true)
    public static String getAudioAnalysisData(Id visitId) {
        try {
            if (visitId == null) {
                throw new AuraHandledException('Visit ID is required');
            }
            
            Visit visitRecord = [
                SELECT Id, Audio_Analysis__c 
                FROM Visit 
                WHERE Id = :visitId 
                LIMIT 1
            ];
            
            return visitRecord.Audio_Analysis__c;
        } catch (Exception e) {
            throw new AuraHandledException('Error retrieving audio analysis data: ' + e.getMessage());
        }
    }
}