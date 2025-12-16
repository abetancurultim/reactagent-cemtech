// src/utils/blueprintProcessor.ts
import * as pdfPoppler from 'pdf-poppler';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
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
  maxTokens: 4096,
  temperature: 0,
});
export interface ExtractedItem {
  description: string;
  quantity: number;
  unit: string; // "lf", "sqft", "ea", "ls"
  confidence: "HIGH" | "MEDIUM" | "ESTIMATE";
  notes: string;
  source_page: string;
}

// Esquema Zod para salida estructurada (garantiza JSON válido siempre)
const extractionSchema = z.object({
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit: z.enum(["lf", "sqft", "cy", "ea", "ls"]),
    confidence: z.enum(["HIGH", "MEDIUM", "ESTIMATE"]),
    notes: z.string(),
    reasoning: z.string().describe("Why did you extract this? E.g., 'Found in Keyed Note 155'")
  }))
});

//! De momento esto no se usará porque llena inmediatamente la ventana de contexto del modelo.
export async function getPdfPageText(filePath: string, pageNum: number): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    
    // pdf-parse devuelve todo el texto junto. 
    // Separarlo por páginas es complejo con esta librería simple, 
    // pero para planos técnicos, el texto suele venir en bloques.
    // Una alternativa más precisa página a página es usar una librería como 'pdfjs-dist',
    
    // NOTA: Para este MVP, pasaremos el texto completo del PDF como referencia.
    return data.text; 
  } catch (e) {
    console.error("Error reading PDF text layer:", e);
    return "";
  }
}

/**
 * Convierte PDF a imágenes usando Poppler (Compatible con Railway + Windows)
 */
export async function convertPdfToImages(filePath: string): Promise<string[]> {
  const absolutePath = path.resolve(filePath);
  const outputDir = path.dirname(absolutePath);
  const baseName = `proc_${Date.now()}_${path.basename(absolutePath, path.extname(absolutePath))}`;
  
  // Aumentamos a 200-300 DPI para que se lean las letras pequeñas
  const options = {
    format: 'png',
    out_dir: outputDir,
    out_prefix: baseName,
    page: null,
    scale: 3840, // Resolución balanceada (calidad vs tokens) -> Subir a 4K 
  };

  try {
    console.log(`[Processor] Converting PDF: ${absolutePath}`);
    await pdfPoppler.convert(absolutePath, options);
    
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith(baseName) && f.endsWith('.png'))
      .sort((a, b) => {
         const numA = parseInt(a.match(/-(\d+)\.png$/)?.[1] || "0");
         const numB = parseInt(b.match(/-(\d+)\.png$/)?.[1] || "0");
         return numA - numB;
      });

    return files.map(f => path.join(outputDir, f));
  } catch (error) {
    console.error("Error converting PDF:", error);
    throw new Error(`Failed to convert PDF.`);
  }
}

/**
 * Fase 1: ¿Es esta página relevante para Cemtech?
 */
export async function isPageRelevant(imagePath: string, pageIndex: number): Promise<boolean> {
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  
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
 * Carga el documento PDF en memoria para extracción de texto.
 */
export async function loadPdfDocument(filePath: string): Promise<pdfjsLib.PDFDocumentProxy> {
  const dataBuffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(dataBuffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  return loadingTask.promise;
}

/**
 * Extrae el texto de una página específica.
 */
export async function getTextFromPage(pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<string> {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    // Unimos los items de texto. A veces es útil añadir saltos de línea, pero un espacio suele bastar.
    return textContent.items.map((item: any) => item.str).join(' ');
  } catch (e) {
    console.error(`Error extracting text from page ${pageNum}:`, e);
    return "";
  }
}

/**
 * Fase 2: Extraer datos cuantificables
 */
export async function extractItemsFromPage(imagePath: string, pageNum: number, pageText: string = ""): Promise<ExtractedItem[]> {
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');

  // Usamos withStructuredOutput para forzar JSON estricto compatible con Zod
  const structuredLlm = visionAnalystModel.withStructuredOutput(extractionSchema);

 const prompt = `
    You are a Senior Estimator for 'Cemtech Enterprise Inc'.
    We specialize in: **Concrete Replacements, Retaining Walls, Poured Walls, and Monolithic Slabs.**
    
    YOUR MISSION: Extract distinct, billable line items for a quote based on this plan (Page ${pageNum}).

    Here is the raw text content extracted from this page to help you read small notes or blurry text:
    """
    ${pageText}
    """
    
    ### CRITICAL SCOPE RULES (READ CAREFULLY):
    1. **"REPLACEMENT" MINDSET:** Look for "Existing to Remain" vs "New". Do NOT quote existing concrete unless the notes say "Remove and Replace" or "Saw cut and Pour back".
    2. **SITE WORK IS KEY:** Look for exterior items:
      - **Bollards:** Count them (Unit: EA).
      - **Curbs/Gutter:** New or Repair (Unit: LF).
      - **Sidewalks/Ramps:** New or Repair (Unit: SQFT).
      - **Dumpster Pads:** (Unit: SQFT or LS).
    3. **INTERIOR RENOVATION:** Look for "Trenching", "Infill", "Equipment Pads" (for new machinery). Ignore the main building slab if it exists.
    
    ### HOW TO EXTRACT:
    - **Read the Keyed Notes:** If Note 155 says "Saw cut 137 sqft", extract exactly "137" and "sqft". This is the most accurate source.
    - **Visual Estimation:** If a note points to a hatched area saying "New Concrete", estimate that specific area.
    - **Retaining Walls:** If found, estimate Length (LF) or Face Area (SQFT).
  `;

  try {
    const response = await structuredLlm.invoke([
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` }
          }
        ]
      }
    ]);

    // Mapear al formato interno
    return response.items.map(item => ({
      ...item,
      unit: item.unit as string,
      confidence: item.confidence as "HIGH" | "MEDIUM" | "ESTIMATE",
      source_page: `Page ${pageNum}`
    }));
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