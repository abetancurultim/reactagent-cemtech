import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { generateQuotePDF } from "../utils/pdfGenerator.js";

// 8. Generate PDF Tool
export const generatePdfTool = tool(
  async ({ quote_id }: { quote_id: string }) => {
    try {
      const pdfUrl = await generateQuotePDF(quote_id);
      return `PDF generated successfully! You can download it here: ${pdfUrl}`;
    } catch (error: any) {
      return `Error generating PDF: ${error.message}`;
    }
  },
  {
    name: "generate_pdf",
    description: "Generate a formal PDF quote for the client. Use this when the client is satisfied with the draft and asks for the final document.",
    schema: z.object({
      quote_id: z.string().describe("The ID of the quote to generate."),
    }),
  }
);