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
// Scout: Rápido y barato para filtrar páginas basura (Electricidad, Plomería)
const visionScoutModel = new ChatOpenAI({
  modelName: "gpt-4o-mini", 
  maxTokens: 150,
  temperature: 0,
});

// Analyst: Potente para leer detalles y tablas pequeñas
const visionAnalystModel = new ChatOpenAI({
  modelName: "gpt-4o",
  maxTokens: 3000,
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
    page: null // null = todas las páginas
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
        text: `You are an expert Estimator for Cemtech (Concrete/Sitework).
        Analyze this image (Page ${pageNum}). Extract QUANTIFIABLE line items for a quote.
        
        Focus on:
        1. Concrete Slabs, Sidewalks, Curbs (measurements or labels).
        2. Demolition notes.
        3. Grading/Excavation.

        Return a JSON ARRAY. Format:
        [
          {
            "description": "Exact text from plan or derived name",
            "quantity": 1, (Number. If unknown/needs calc, put 1 and mention dimensions in notes)
            "unit": "ls", (ls, sqft, lf, cy, ea)
            "notes": "Page ${pageNum}. Specs found: 4000psi, 6 inch depth, etc."
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