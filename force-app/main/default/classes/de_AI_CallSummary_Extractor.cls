public class de_AI_CallSummary_Extractor {

    /* =====================================================
       FLOW INPUT
       ===================================================== */
    public class FlowInput {
        @InvocableVariable(required=true)
        public String promptResponseJson;
    }

    /* =====================================================
       FLOW OUTPUT
       ===================================================== */
    public class FlowOutput {
        @InvocableVariable
        public String callSummary;

        @InvocableVariable
        public Boolean success;

        @InvocableVariable
        public String errorMessage;
    }

    /* =====================================================
       INVOCABLE METHOD
       ===================================================== */
    @InvocableMethod(
        label='Extract Call Summary from AI Response'
        description='Extracts call_summary from AI prompt JSON output'
    )
    public static List<FlowOutput> extractCallSummary(List<FlowInput> inputs) {

        List<FlowOutput> outputs = new List<FlowOutput>();

        for (FlowInput input : inputs) {
            FlowOutput out = new FlowOutput();

            try {
                if (String.isBlank(input.promptResponseJson)) {
                    out.success = false;
                    out.errorMessage = 'Input JSON is blank';
                    outputs.add(out);
                    continue;
                }

                Map<String, Object> root =
                    (Map<String, Object>) JSON.deserializeUntyped(input.promptResponseJson);

                if (!root.containsKey('call_summary')) {
                    out.success = false;
                    out.errorMessage = 'call_summary not found in JSON';
                    outputs.add(out);
                    continue;
                }

                Object summaryObj = root.get('call_summary');

                out.callSummary = summaryObj == null
                    ? null
                    : String.valueOf(summaryObj);

                out.success = true;

            } catch (Exception e) {
                out.success = false;
                out.errorMessage = e.getMessage();
            }

            outputs.add(out);
        }

        return outputs;
    }
}