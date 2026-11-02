/**
 * Test class for de_AudioAnalysisController
 * Tests the getAudioAnalysisData method
 */
@isTest
private class de_AudioAnalysisControllerTest {

    @isTest
    static void testGetAudioAnalysisData_Success() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com',
            Audio_Analysis__c = '{"transcription": "Test audio transcription", "sentiment": "positive"}'
        );
        insert testLead;

        Test.startTest();
        String result = de_AudioAnalysisController.getAudioAnalysisData(testLead.Id);
        Test.stopTest();

        System.assertEquals(testLead.Audio_Analysis__c, result, 'Audio analysis data should match');
        System.assertNotEquals(null, result, 'Result should not be null');
    }

    @isTest
    static void testGetAudioAnalysisData_NullLeadId() {
        Test.startTest();
        try {
            de_AudioAnalysisController.getAudioAnalysisData(null);
            System.assert(false, 'Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            System.assert(true, 'AuraHandledException was thrown as expected');
        } catch (Exception e) {
            System.assert(false, 'Expected AuraHandledException but got: ' + e.getTypeName());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioAnalysisData_InvalidLeadId() {
        Id invalidId = '00Q000000000000AAA';

        Test.startTest();
        try {
            de_AudioAnalysisController.getAudioAnalysisData(invalidId);
            System.assert(false, 'Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            System.assert(true, 'AuraHandledException was thrown as expected');
        } catch (Exception e) {
            System.assert(false, 'Expected AuraHandledException but got: ' + e.getTypeName());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioAnalysisData_NullAudioAnalysis() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com'
        );
        insert testLead;

        Test.startTest();
        String result = de_AudioAnalysisController.getAudioAnalysisData(testLead.Id);
        Test.stopTest();

        System.assertEquals(null, result, 'Result should be null when Audio_Analysis__c is null');
    }

    @isTest
    static void testGetAudioAnalysisData_EmptyAudioAnalysis() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com',
            Audio_Analysis__c = ''
        );
        insert testLead;

        Test.startTest();
        String result = de_AudioAnalysisController.getAudioAnalysisData(testLead.Id);
        Test.stopTest();

        System.assert(result == null || result == '',
            'Result should be null or empty string. Actual: ' + result);
    }

    @isTest
    static void testGetAudioAnalysisData_LargeJsonData() {
        String largeJson = '{"data": "' + String.valueOf(Math.random()).repeat(1000) + '"}';

        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com',
            Audio_Analysis__c = largeJson
        );
        insert testLead;

        Test.startTest();
        String result = de_AudioAnalysisController.getAudioAnalysisData(testLead.Id);
        Test.stopTest();

        System.assertEquals(largeJson, result, 'Large JSON data should be retrieved correctly');
    }
}
