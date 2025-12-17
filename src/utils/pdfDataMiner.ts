// src/utils/pdfDataMiner.ts
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

interface TextElement {
  text: string;
  x: number;
  y: number;
}

export async function getPageTextWithCoords(pdfPath: string, pageIndex: number): Promise<TextElement[]> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);

    const loadingTask = pdfjsLib.getDocument({ 
      data: uint8Array,
      disableFontFace: false 
    });
    
    const doc = await loadingTask.promise;
    
    // Validación de páginas
    if (pageIndex < 0 || pageIndex >= doc.numPages) {
      console.warn(`[pdfDataMiner] Page index ${pageIndex} out of bounds (Total: ${doc.numPages})`);
      return [];
    }

    // PDF.js usa índices base 1 (Página 1, 2, 3...)
    // El código envía base 0 (0, 1, 2...), así que sumamos 1.
    const page = await doc.getPage(pageIndex + 1);
    
    // Obtener el Viewport para poder normalizar coordenadas del PDF
    // (PDFs tienen origen Y abajo, Imágenes tienen origen Y arriba)
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const items: TextElement[] = textContent.items
      .filter((item: any) => item.str && item.str.trim().length > 0) // Filtrar vacíos
      .map((item: any) => {
        // item.transform es [scaleX, skewY, skewX, scaleY, tx, ty]
        const tx = item.transform[4]; // Coordenada X
        const ty = item.transform[5]; // Coordenada Y (desde abajo)

        // Convertir coordenada "Y" para que coincida con la visión humana (desde arriba)
        const yImage = viewport.height - ty;

        return {
          text: item.str,
          x: Math.round(tx),
          y: Math.round(yImage)
        };
      });

    return items;

  } catch (error) {
    console.error("Error in pdfDataMiner with pdfjs-dist:", error);
    return [];
  }
}