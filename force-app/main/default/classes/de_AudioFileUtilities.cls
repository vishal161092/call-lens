public class de_AudioFileUtilities {

	@AuraEnabled
	public static String getAudioURL (String recId){
		try {
			if (String.isBlank(recId)) {
				throw new AuraHandledException('Lead ID is required');
			}

			// Find latest uploaded files linked to the lead, newest first
			List<ContentDocumentLink> links = [
				SELECT ContentDocumentId, ContentDocument.CreatedDate, ContentDocument.FileType
				FROM ContentDocumentLink
				WHERE LinkedEntityId = :recId
				ORDER BY ContentDocument.CreatedDate DESC
			];

			if (links.isEmpty()) {
				throw new AuraHandledException('No files found on Lead record');
			}

			// Pick the latest audio file only
			Set<String> audioTypes = new Set<String>{ 'MP3', 'WAV', 'M4A', 'AAC', 'OGG', 'WEBM', 'MP4', 'MPEG', 'MPGA' };
			String latestAudioDocumentId;
			for (ContentDocumentLink linkRec : links) {
				String fileType = linkRec.ContentDocument != null ? linkRec.ContentDocument.FileType : null;
				if (fileType != null && audioTypes.contains(fileType.toUpperCase())) {
					latestAudioDocumentId = linkRec.ContentDocumentId;
					break;
				}
			}

			if (String.isBlank(latestAudioDocumentId)) {
				throw new AuraHandledException('No audio file found on Lead record');
			}

			String audioURL = '/sfc/servlet.shepherd/document/download/' + latestAudioDocumentId + '?operationContext=S1';
			return audioURL;
		} catch (AuraHandledException e) {
			throw e;
		} catch (Exception e) {
			throw new AuraHandledException('Error retrieving audio URL: ' + e.getMessage());
		}
	}

	@AuraEnabled
	public static String getAudioFileContent (String recId){
		try {
			Lead vc = [SELECT Id, File_Id__c FROM Lead WHERE Id =: recId LIMIT 1];

			if (String.isBlank(vc.File_Id__c)) {
				throw new AuraHandledException('File ID not found on Lead record');
			}

			// Get the latest ContentVersion for this ContentDocument
			ContentVersion cv = [
				SELECT Id, VersionData, FileType, ContentDocumentId
				FROM ContentVersion
				WHERE ContentDocumentId = :vc.File_Id__c
				AND IsLatest = true
				LIMIT 1
			];

			if (cv == null) {
				throw new AuraHandledException('ContentVersion not found for File ID: ' + vc.File_Id__c);
			}

			// Convert VersionData (Blob) to base64 string
			String base64Content = EncodingUtil.base64Encode(cv.VersionData);

			// Return JSON with base64 content and file type
			return JSON.serialize(new Map<String, String>{
				'content' => base64Content,
				'fileType' => cv.FileType,
				'contentDocumentId' => cv.ContentDocumentId
			});

		} catch (Exception e) {
			throw new AuraHandledException('Error retrieving audio file: ' + e.getMessage());
		}
	}
}
