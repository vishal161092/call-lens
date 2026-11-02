public with sharing class de_Split_String_For_Flow {

    @InvocableMethod(
        label='Split Comma Separated String'
        description='Splits a comma-separated string into a Text Collection'
    )
    public static List<List<String>> splitString(List<String> inputs) {

        List<List<String>> results = new List<List<String>>();

        for (String input : inputs) {
            List<String> splitValues = new List<String>();

            if (!String.isBlank(input)) {
                for (String val : input.split(',')) {
                    splitValues.add(val.trim());
                }
            }

            results.add(splitValues);
        }

        return results;
    }
}
