// src/utils/blueprintProcessor.ts
import * as pdfPoppler from 'pdf-poppler';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import dotenv from "dotenv";

dotenv.config();

// 1. Configuración de Modelos
// Scout: Este modelo se encargará de filtrar páginas basura (Electricidad, Plomería)
const visionScoutModel = new ChatOpenAI({
  modelName: "gpt-4o-mini", 
  maxTokens: 150,
  temperature: 0,
});

// Analyst: Irá al detalle para extraer cantidades y dimensiones
const visionAnalystModel = new ChatOpenAI({
  modelName: "gpt-4.1-2025-04-14",
  maxTokens: 4000,
  temperature: 0,
});

export interface ExtractedItem {
  description: string;
  quantity: number;
  unit: string;
  notes: string;
}

/**
 * Convierte PDF a imágenes usando Poppler (Compatible con Railway + Windows)
 */
export async function convertPdfToImages(filePath: string): Promise<Uint8Array[]> {
  const absolutePath = path.resolve(filePath);
  const outputDir = path.dirname(absolutePath);
  // Usamos un prefijo único con timestamp para evitar colisiones si se analizan 2 planos a la vez
  const baseName = `temp_${Date.now()}_${path.basename(absolutePath, path.extname(absolutePath))}`;
  
  const options = {
    format: 'png',
    out_dir: outputDir,
    out_prefix: baseName,
    page: null, // null = todas las páginas
    scale: 2048, // Mejor resolución de cada imagen para OCR
  };

  try {
    console.log(`Converting PDF: ${absolutePath}`);
    await pdfPoppler.convert(absolutePath, options);
    
    // Buscar los archivos generados
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith(baseName) && f.endsWith('.png'))
      .sort((a, b) => {
         // Ordenar numéricamente (file-1.png, file-2.png...)
         const numA = parseInt(a.match(/-(\d+)\.png$/)?.[1] || "0");
         const numB = parseInt(b.match(/-(\d+)\.png$/)?.[1] || "0");
         return numA - numB;
      });

    // Leer buffers y limpiar disco inmediatamente
    const imageBuffers = files.map(file => {
      const fullPath = path.join(outputDir, file);
      const buffer = fs.readFileSync(fullPath);
      try { fs.unlinkSync(fullPath); } catch (e) {} // Borrar temporal
      return buffer;
    });

    console.log(`Converted ${imageBuffers.length} pages to images.`);
    return imageBuffers;

  } catch (error) {
    console.error("Error converting PDF:", error);
    throw new Error(`Failed to convert PDF. Error: ${error}`);
  }
}

/**
 * Fase 1: ¿Es esta página relevante para Cemtech?
 */
export async function isPageRelevant(imageBuffer: Uint8Array, pageIndex: number): Promise<boolean> {
  const imageBase64 = Buffer.from(imageBuffer).toString('base64');
  
  const message = new HumanMessage({
    content: [
      {
        type: "text",
        text: `Analyze this blueprint page (Page ${pageIndex + 1}). 
        Does it contain plans, notes, or details relevant to: Concrete, Demolition, Grading, Site Work, or Paving?
        Ignore Electrical, Plumbing, Mechanical, or pure Architectural elevations unless they show concrete work.
        Reply ONLY with "YES" or "NO".`
      },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${imageBase64}` }
      }
    ]
  });

  try {
    const response = await visionScoutModel.invoke([message]);
    const content = response.content.toString().trim().toUpperCase();
    console.log(`Page ${pageIndex + 1} Analysis: ${content}`);
    return content.includes("YES");
  } catch (e) {
    console.error(`Error analyzing page ${pageIndex}:`, e);
    return false;
  }
}

/**
 * Fase 2: Extraer datos cuantificables
 */
export async function extractItemsFromPage(imageBuffer: Uint8Array, pageNum: number): Promise<ExtractedItem[]> {
  const imageBase64 = Buffer.from(imageBuffer).toString('base64');

  const message = new HumanMessage({
    content: [
      {
        type: "text",
        text: `You are an expert Senior Estimator for Cemtech (Concrete/Sitework).
        Analyze this High-Resolution plan (Page ${pageNum}) to perform a QUANTITY TAKEOFF.

        Your goal is to find **NUMBERS** and **DIMENSIONS**. Do not just list items.

        STRATEGY TO FIND QUANTITIES:
        1. **Look for TABLES/SCHEDULES**: Architects often put a "Material Quantity Schedule" or "Finish Schedule" on the plan. Extract quantities directly from there if valid.
        2. **Look for DIMENSION LINES**: If you see a Concrete Slab, look for text like "20' x 40'" or "2500 SF".
        3. **Calculate if Simple**: If you see a rectangular slab with dimensions clearly labeled (e.g., 10' and 20'), calculate the area (200 sqft) yourself.
        4. **Look for THICKNESS**: Look for notes like "4 inch slab", "6 inch depth" to add to notes.

        FORMAT INSTRUCTIONS:
        - If you find a dimension (e.g., 100 LF of Curb), put '100' in quantity and 'lf' in unit.
        - If you find an area (e.g., 500 SF of Sidewalk), put '500' in quantity and 'sqft' in unit.
        - **CRITICAL**: If you definitively CANNOT find a number, put Quantity: 1, Unit: "ls" (Lump Sum), and in 'notes' explicitly say: "Dimensions not found on plan, requires manual scaling."

        Return a JSON ARRAY. Format:
        [
          {
            "description": "Concrete Slab (Interior)",
            "quantity": 2500,
            "unit": "sqft",
            "notes": "Calculated from dimensions 50x50 found on Grid A-C. Spec: 4000psi"
          }
        ]
        
        Output ONLY valid JSON. No markdown.`
      },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${imageBase64}` }
      }
    ]
  });

  try {
    const response = await visionAnalystModel.invoke([message]);
    const text = response.content.toString().replace(/```json|```/g, "").trim();
    return JSON.parse(text) as ExtractedItem[];
  } catch (e) {
    console.error(`Failed to extract from page ${pageNum}`, e);
    return [];
  }
}

/**
 * Descarga un PDF desde una URL y lo guarda temporalmente.
 */
export async function downloadPdfFromUrl(url: string): Promise<string> {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  // Asegurar que el directorio exista
  const outputDir = path.resolve('public/quotes');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const tempFileName = `download_${Date.now()}.pdf`;
  const tempFilePath = path.join(outputDir, tempFileName);
  
  const writer = fs.createWriteStream(tempFilePath);

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(tempFilePath));
    writer.on('error', reject);
  });
}