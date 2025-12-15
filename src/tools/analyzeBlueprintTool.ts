// src/tools/analyzeBlueprintTool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs";
import { convertPdfToImages, isPageRelevant, extractItemsFromPage, ExtractedItem, downloadPdfFromUrl } from "../utils/blueprintProcessor.js";

const schema = z.object({
  filePath: z.string().optional().describe("The relative path to the PDF file (e.g., 'public/quotes/bid_set.pdf'). Use this if the file is local."),
  pdfUrl: z.string().optional().describe("The URL of the PDF file to download and analyze. Use this if the file is hosted remotely."),
});

export const analyzeBlueprintTool = tool(
  async ({ filePath, pdfUrl }) => {
    let targetPath = filePath;
    let isTempFile = false;

    try {
      if (pdfUrl) {
        targetPath = await downloadPdfFromUrl(pdfUrl);
        isTempFile = true;
      }

      if (!targetPath) {
        return "Error: You must provide either 'filePath' or 'pdfUrl'.";
      }

      // 1. Convertir
      const images = await convertPdfToImages(targetPath);
      
      if (images.length === 0) return "Error: No pages found in PDF.";

      const relevantItems: ExtractedItem[] = [];
      let processedPages = 0;

      // 2. Loop Map-Reduce
      // Limitamos a max 15 páginas relevantes para proteger tokens/costos por ahora
      for (let i = 0; i < images.length; i++) {
        const isRelevant = await isPageRelevant(images[i], i);
        
        if (isRelevant) {
          processedPages++;
          const items = await extractItemsFromPage(images[i], i + 1);
          relevantItems.push(...items);
          
          if (processedPages >= 15) break; // Safety break
        }
      }

      if (relevantItems.length === 0) {
        return "Analysis finished. PDF was read, but no relevant Concrete/Sitework pages were identified.";
      }

      // 3. Retornar resumen para el Agente
      return JSON.stringify({
        status: "success",
        total_pages_scanned: images.length,
        relevant_pages_found: processedPages,
        items_extracted: relevantItems
      }, null, 2);

    } catch (error: any) {
      return `Error analyzing blueprint: ${error.message}`;
    } finally {
      // Cleanup temp file if downloaded
      if (isTempFile && targetPath && fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch (e) {
          console.error("Error deleting temp file:", e);
        }
      }
    }
  },
  {
    name: "analyze_blueprint",
    description: "VISION TOOL. Reads a construction PDF plan. Filters relevant pages (Concrete/Demo) and extracts line items automatically. Returns a JSON list of items to be added to the quote.",
    schema,
  }
);