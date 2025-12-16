// src/utils/blueprintProcessor.ts
import * as pdfPoppler from 'pdf-poppler';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
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
    scale: 3072, // Mejor resolución de cada imagen para OCR
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
        text: `
          You are a Senior Estimator for 'Cemtech Enterprise Inc'.
          We specialize in: **Concrete Replacements, Retaining Walls, Poured Walls, and Monolithic Slabs.**
    
          YOUR MISSION: Extract distinct, billable line items for a quote based on this plan (Page ${pageNum}).
    
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
    
          ### OUTPUT FORMAT:
          Return a JSON ARRAY. If no *billable* work is found, return [].
    
          Example Output:
          [
            {
              "description": "Front Facade - Saw cut, demo and pour back sidewalk (Note 155)",
              "quantity": 137,
              "unit": "sqft",
              "notes": "Explicitly stated in Note 155. Includes new footing."
            },
            {
              "description": "Install Pipe Bollards (Labor Only)",
              "quantity": 7,
              "unit": "ea",
              "notes": "Standard 6 inch bollards near entrance."
            },
            {
              "description": "Pour New Equipment Pad",
              "quantity": 64,
              "unit": "sqft",
              "notes": "6 inch thick pad for HVAC unit."
            }
          ]

          Output ONLY valid JSON. No markdown.
        `
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