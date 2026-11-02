/**
 * Test class for de_visit_audio_analysis_dashboard_apex
 */
@isTest
private class de_VisitAudioAnalysisDashboardTest {

    @isTest
    static void testGetAudioAnalysisDataNullId() {
        Boolean exceptionThrown = false;
        try {
            de_visit_audio_analysis_dashboard_apex.getAudioAnalysisData(null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw AuraHandledException for null ID');
    }
}
