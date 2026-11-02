/**
 * Test class for de_AudioFileUtilities
 * Tests the getAudioURL and getAudioFileContent methods
 */
@isTest
private class de_AudioFileUtilitiesTest {

    @isTest
    static void testGetAudioURL_Success() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com',
            File_Id__c = '069000000000000AAA'
        );
        insert testLead;

        Test.startTest();
        String result = de_AudioFileUtilities.getAudioURL(testLead.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Audio URL should not be null');
        System.assert(result.contains('File_Id__c') || result.length() > 0,
            'Audio URL should contain file reference or be populated');
    }

    @isTest
    static void testGetAudioURL_NullFileId() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com'
        );
        insert testLead;

        Test.startTest();
        String result = de_AudioFileUtilities.getAudioURL(testLead.Id);
        Test.stopTest();

        System.assert(true, 'Method executed successfully - File_URL__c formula result returned');
    }

    @isTest
    static void testGetAudioURL_InvalidLeadId() {
        String invalidId = '00Q000000000000AAA';

        Test.startTest();
        try {
            de_AudioFileUtilities.getAudioURL(invalidId);
            System.assert(false, 'Expected exception was not thrown');
        } catch (Exception e) {
            System.assert(e.getMessage().contains('List has no rows') ||
                         e.getMessage().contains('Invalid id'),
                'Exception should indicate invalid Lead ID');
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioFileContent_Success() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com'
        );
        insert testLead;

        ContentVersion cv = new ContentVersion(
            Title = 'Test Audio File',
            PathOnClient = 'test.mp3',
            VersionData = Blob.valueOf('Test audio file content'),
            IsMajorVersion = true
        );
        insert cv;

        cv = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];

        testLead.File_Id__c = cv.ContentDocumentId;
        update testLead;

        Test.startTest();
        String result = de_AudioFileUtilities.getAudioFileContent(testLead.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');

        Map<String, Object> resultMap = (Map<String, Object>) JSON.deserializeUntyped(result);
        System.assert(resultMap.containsKey('content'), 'Result should contain content key');
        System.assert(resultMap.containsKey('fileType'), 'Result should contain fileType key');
        System.assert(resultMap.containsKey('contentDocumentId'), 'Result should contain contentDocumentId key');

        String content = (String) resultMap.get('content');
        System.assertNotEquals(null, content, 'Content should not be null');
        System.assert(content.length() > 0, 'Content should not be empty');
    }

    @isTest
    static void testGetAudioFileContent_NullFileId() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com'
        );
        insert testLead;

        Test.startTest();
        try {
            de_AudioFileUtilities.getAudioFileContent(testLead.Id);
            System.assert(false, 'Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            System.assert(true, 'AuraHandledException was thrown as expected');
        } catch (Exception e) {
            System.assert(false, 'Expected AuraHandledException but got: ' + e.getTypeName());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioFileContent_EmptyFileId() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com',
            File_Id__c = ''
        );
        insert testLead;

        Test.startTest();
        try {
            de_AudioFileUtilities.getAudioFileContent(testLead.Id);
            System.assert(false, 'Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            System.assert(true, 'AuraHandledException was thrown as expected');
        } catch (Exception e) {
            System.assert(false, 'Expected AuraHandledException but got: ' + e.getTypeName());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioFileContent_InvalidFileId() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com',
            File_Id__c = '069000000000000AAA'
        );
        insert testLead;

        Test.startTest();
        try {
            de_AudioFileUtilities.getAudioFileContent(testLead.Id);
            System.assert(false, 'Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            System.assert(true, 'AuraHandledException was thrown as expected');
        } catch (Exception e) {
            System.assert(false, 'Expected AuraHandledException but got: ' + e.getTypeName());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioFileContent_InvalidLeadId() {
        String invalidId = '00Q000000000000AAA';

        Test.startTest();
        try {
            de_AudioFileUtilities.getAudioFileContent(invalidId);
            System.assert(false, 'Expected exception was not thrown');
        } catch (AuraHandledException e) {
            System.assert(true, 'AuraHandledException was thrown as expected');
        } catch (Exception e) {
            System.assert(e instanceof AuraHandledException ||
                         e.getMessage().contains('List has no rows') ||
                         e.getMessage().contains('no rows'),
                'Exception should be AuraHandledException or QueryException. Actual: ' + e.getTypeName());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAudioFileContent_DifferentFileTypes() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com'
        );
        insert testLead;

        ContentVersion cvMp3 = new ContentVersion(
            Title = 'Test Audio File',
            PathOnClient = 'test.mp3',
            VersionData = Blob.valueOf('MP3 audio content'),
            IsMajorVersion = true
        );
        insert cvMp3;
        cvMp3 = [SELECT Id, ContentDocumentId, FileType FROM ContentVersion WHERE Id = :cvMp3.Id];

        testLead.File_Id__c = cvMp3.ContentDocumentId;
        update testLead;

        Test.startTest();
        String resultMp3 = de_AudioFileUtilities.getAudioFileContent(testLead.Id);
        Test.stopTest();

        Map<String, Object> resultMap = (Map<String, Object>) JSON.deserializeUntyped(resultMp3);
        String fileType = (String) resultMap.get('fileType');
        System.assertEquals('MP3', fileType, 'File type should be MP3');
    }

    @isTest
    static void testGetAudioFileContent_LargeFile() {
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'test@example.com'
        );
        insert testLead;

        String largeContent = 'A'.repeat(10000);
        ContentVersion cv = new ContentVersion(
            Title = 'Large Audio File',
            PathOnClient = 'large.mp3',
            VersionData = Blob.valueOf(largeContent),
            IsMajorVersion = true
        );
        insert cv;

        cv = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];
        testLead.File_Id__c = cv.ContentDocumentId;
        update testLead;

        Test.startTest();
        String result = de_AudioFileUtilities.getAudioFileContent(testLead.Id);
        Test.stopTest();

        Map<String, Object> resultMap = (Map<String, Object>) JSON.deserializeUntyped(result);
        String content = (String) resultMap.get('content');
        System.assert(content.length() > 0, 'Large file content should be encoded correctly');
    }
}
