import { supabase } from "./src/utils/functions.js";
import { TABLES } from "./src/config/tables.js";
import { generateQuotePDF } from "./src/utils/pdfGenerator.js";

async function testPdf() {
    console.log("Starting PDF generation test...");

    // 1. Create a dummy quote
    // Note: Adjust fields based on your actual schema if this fails.
    const quoteData = {
        client_number: "TEST-CLIENT-001",
        project_name: "Test Project PDF Generation",
        // status: "draft" 
    };

    console.log("Creating quote...");
    const { data: quote, error: quoteError } = await supabase
        .from(TABLES.QUOTES)
        .insert(quoteData)
        .select()
        .single();

    if (quoteError) {
        console.error("Error creating quote:", quoteError);
        return;
    }

    console.log("Created quote:", quote.id);

    // 2. Create dummy lines
    const linesData = [
        {
            quote_id: quote.id,
            description: "Main Item 1",
            scope_of_work: "Scope for item 1",
            subtotal: 1000,
            // quantity: 1, 
            // unit: "EA"
        },
        {
            quote_id: quote.id,
            description: "Main Item 2",
            scope_of_work: "Scope for item 2",
            subtotal: 500
        }
    ];

    console.log("Creating lines...");
    const { error: linesError } = await supabase
        .from(TABLES.QUOTE_LINES)
        .insert(linesData);

    if (linesError) {
        console.error("Error creating lines:", linesError);
        return;
    }

    console.log("Created lines");

    // 3. Generate PDF
    try {
        console.log("Calling generateQuotePDF...");
        const url = await generateQuotePDF(quote.id);
        console.log("PDF Generated successfully!");
        console.log("URL:", url);
    } catch (error) {
        console.error("Error generating PDF:", error);
    }
}

testPdf();
