"use strict";
// import Docxtemplater from 'docxtemplater';
// import PizZip from 'pizzip';
// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { initializeApp } from "firebase/app";
// import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
// import { v4 as uuidv4 } from 'uuid';
// import dotenv from 'dotenv';
// import libre from 'libreoffice-convert';
// dotenv.config();
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// // Configuración de Firebase
// const firebaseConfig = {
//   apiKey: process.env.FIREBASE_API_KEY,
//   authDomain: process.env.FIREBASE_AUTH_DOMAIN,
//   projectId: process.env.FIREBASE_PROJECT_ID,
//   storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
//   messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
//   appId: process.env.FIREBASE_APP_ID
// };
// initializeApp(firebaseConfig);
// const storage = getStorage();
// export interface QuoteItem {
//   sku: string;
//   description: string;
//   qty: number;
//   price: number;
// }
// export async function createQuotePDF(
//   items: QuoteItem[],
//   phoneNumber: string,
//   client: string,
//   address: string,
//   city: string
// ): Promise<string> {
//   // fechas
//   const dateDocument = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
//   const dateExpiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
//     .toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
//   // calcular totales
//   const itemsWithTotals = items.map(i => ({
//     ...i,
//     totalPrice: i.qty * i.price
//   }));
//   const subtotal = itemsWithTotals.reduce((acc, i) => acc + i.totalPrice, 0);
//   const iva = subtotal * 0.19;
//   const total = subtotal + iva;
//   const datos = {
//     client,
//     address,
//     phoneNumber,
//     city,
//     dateDocument,
//     dateExpiration,
//     items: itemsWithTotals,
//     subtotal,
//     iva,
//     total
//   };
//   const docId = uuidv4();
//   try {
//     // Leer y renderizar plantilla .docx
//     const plantillaPath = path.resolve(__dirname, '../templates/cotizacion-fenix.docx');
//     const plantillaBuf = fs.readFileSync(plantillaPath);
//     const zip = new PizZip(plantillaBuf);
//     const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
//     // Renderizar la plantilla con los datos
//     try {
//       doc.render(datos);
//     } catch (templateError: any) {
//       console.error('Error en la plantilla:', templateError);
//       if (templateError.properties && templateError.properties.errors) {
//         console.error('Errores detallados:', JSON.stringify(templateError.properties.errors, null, 2));
//       }
//       throw templateError;
//     }
//     const docxBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
//     // Convertir a PDF en memoria
//     const extend = '.pdf';
//     const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
//       libre.convert(docxBuffer, extend, undefined, (err, done) => {
//         if (err) return reject(err);
//         resolve(done as Buffer);
//       });
//     });
//     // Nombre y referencia en Storage
//     const nombrePDF = `quotes/cotizacion_${docId}.pdf`;
//     const storageRef = ref(storage, nombrePDF);
//     // Subir el PDF
//     await uploadBytesResumable(storageRef, pdfBuffer, {
//       contentType: 'application/pdf',
//     });
//     // Obtener URL descargable
//     const url = await getDownloadURL(storageRef);
//     console.log(`PDF subido y disponible en: ${url}`);
//     // Enviar PDF por WhatsApp
//     await sendQuoteToWhatsApp(url, phoneNumber);
//     return url;
//   } catch (error: any) {
//     console.error('Error creando cotización PDF:', error);
//     throw new Error('No se pudo generar la cotización en PDF');
//   }
// }
// Ejemplo de uso
// createQuotePDF([{ sku: 'CS-CP1-R105-Prueba', description: 'Cámara de seguridad Fénix - Prueba PDF', qty: 1, price: 1000 }], '1234567890', 'Cliente Prueba', 'Dirección Prueba', 'Ciudad Prueba')
//   .then(console.log)
//   .catch(console.error);
