// src/tools/analyzeBlueprintTool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs";
import { convertPdfToImages, isPageRelevant, extractItemsFromPage, ExtractedItem, downloadPdfFromUrl } from "../utils/blueprintProcessor.js";

const schema = z.object({
  filePath: z.string().optional().describe("The relative path to the PDF file (e.g., 'public/quotes/bid_set.pdf')."),
  pdfUrl: z.string().optional().describe("The URL of the PDF to analyze."),
});

export const analyzeBlueprintTool = tool(
  async ({ filePath, pdfUrl }) => {
    let targetPath = filePath;
    let isTempFile = false;
    let imagePaths: string[] = [];

    try {
      // 1. Obtener Archivo
      if (pdfUrl) {
        targetPath = await downloadPdfFromUrl(pdfUrl);
        isTempFile = true;
      }

      if (!targetPath || !fs.existsSync(targetPath)) {
        return "Error: File not found or no path provided.";
      }

      // 2. Convertir a Imágenes (Alta Resolución)
      imagePaths = await convertPdfToImages(targetPath);
      
      if (imagePaths.length === 0) return "Error: No pages extracted from PDF.";

      const relevantData: ExtractedItem[] = [];
      let scannedPages = 0;
      let relevantPagesCount = 0;

      // 3. Map-Reduce Loop
      // Analizamos máximo 100 páginas para control de presupuesto
      const MAX_PAGES_TO_ANALYZE = 100;

      for (const imgPath of imagePaths) {
        if (scannedPages >= MAX_PAGES_TO_ANALYZE) break;
        
        // Fase Map: ¿Es relevante?
        const isRelevant = await isPageRelevant(imgPath, scannedPages);
        
        if (isRelevant) {
          relevantPagesCount++;
          // Fase Reduce: Extraer datos
          const items = await extractItemsFromPage(imgPath, scannedPages + 1);
          relevantData.push(...items);
        }
        
        scannedPages++;
      }

      // 4. Limpieza de imágenes temporales
      imagePaths.forEach(p => {
        try { fs.unlinkSync(p); } catch(e) {}
      });

      if (relevantData.length === 0) {
        return JSON.stringify({
          status: "completed_empty",
          message: "Scanned pages but found no specific Concrete/Site work items."
        });
      }

      // 5. Retorno estructurado para el Agente
      return JSON.stringify({
        status: "success",
        relevant_pages: relevantPagesCount,
        total_scanned: scannedPages,
        items: relevantData
      }, null, 2);

    } catch (error: any) {
      return `Error in blueprint analysis: ${error.message}`;
    } finally {
      // Cleanup PDF temporal
      if (isTempFile && targetPath && fs.existsSync(targetPath)) {
        try { fs.unlinkSync(targetPath); } catch (e) {}
      }
      // Cleanup imágenes si falló antes
      imagePaths.forEach(p => {
        if(fs.existsSync(p)) try { fs.unlinkSync(p); } catch(e) {}
      });
    }
  },
  {
    name: "analyze_blueprint",
    description: "VISION ESTIMATOR. Scans PDF blueprints. Filters for Concrete/Civil/Demo pages only. Extracts quantities, notes, and dimensions. Returns JSON items.",
    schema,
  }
);