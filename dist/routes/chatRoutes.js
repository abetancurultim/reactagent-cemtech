import dotenv from "dotenv";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { HumanMessage } from "@langchain/core/messages";
import fetch from "node-fetch";
import { OpenAI, toFile } from "openai";
import twilio from "twilio";
import NodeCache from 'node-cache'; // Importar caché
import { initializeApp } from "firebase/app";
import { getDownloadURL, getStorage, ref, uploadBytesResumable, } from "firebase/storage";
import { ElevenLabsClient } from "elevenlabs";
import path from "path";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import { fileURLToPath } from "url";
import { saveChatHistory, saveTemplateChatHistory, updateMessageTwilioSid, } from "../utils/saveHistoryDb.js";
import { getAvailableChatOn } from "../utils/getAvailableChatOn.js";
import { getAvailableForAudio } from "../utils/getAvailableForAudio.js";
import { appWithMemory } from "../agents/mainAgent.js";
import { getCampaignOrigin } from "../utils/campaignDetector.js";
import { supabase } from "../utils/saveHistoryDb.js";
import { delay, getRandomDelay } from "../utils/delayFunctions.js";
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const statusCallbackUrl = `https://ultim.online`;
dotenv.config();
const MessagingResponse = twilio.twiml.MessagingResponse; // mandar un texto simple
// ----------
// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;
const accountSid = process.env.TWILIO_ULTIM_ACCOUNT_SID;
const authToken = process.env.TWILIO_ULTIM_AUTH_TOKEN;
// ---------
const client = twilio(accountSid, authToken); // mandar un texto con media
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
// ElevenLabs Client
const elevenlabsClient = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});
// Caché para asesores (24 horas)
const advisorCache = new NodeCache({ stdTTL: 86400 });
// Función para obtener asesor por número de Twilio
const getAdvisorByTwilioNumber = async (twilioNumber) => {
    // Intentar desde caché primero
    let advisor = advisorCache.get(`advisor_${twilioNumber}`);
    if (!advisor) {
        const { data } = await supabase
            .from('advisors')
            .select('*')
            .eq('twilio_phone_number', twilioNumber)
            .eq('is_active', true)
            .single();
        if (data) {
            advisorCache.set(`advisor_${twilioNumber}`, data);
            advisor = data;
        }
    }
    return advisor || null;
};
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const storage = getStorage();
const createAudioStreamFromText = async (text) => {
    const audioStream = await elevenlabsClient.generate({
        voice: "Andrea",
        model_id: "eleven_flash_v2_5",
        text,
    });
    const chunks = [];
    for await (const chunk of audioStream) {
        chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);
    return content;
};
let exportedFromNumber;
let globalConfig = {
    configurable: {
        thread_id: "",
        phone_number: "",
        advisor_id: "",
    },
};
// Función helper para reintentar la descarga de media cuando Twilio aún no ha terminado de procesarla
const fetchMediaWithRetry = async (url, options, retries = 3, delayMs = 1500) => {
    for (let attempt = 0; attempt < retries; attempt++) {
        const res = await fetch(url, options);
        if (res.ok)
            return res;
        // 404 / 409 suelen indicar que el archivo aún no está disponible
        if (attempt < retries - 1 && (res.status === 404 || res.status === 409)) {
            console.log(`⏳ Intento ${attempt + 1} falló con ${res.status}, reintentando en ${delayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
        }
        throw new Error(`Failed to fetch media from Twilio: ${res.status} ${res.statusText}`);
    }
    // Nunca debería llegar aquí
    throw new Error("Unexpected error fetching media");
};
// Endpoint para procesar mensajes
router.post("/asadores/receive-message", async (req, res) => {
    const twiml = new MessagingResponse();
    const from = req.body.From;
    const to = req.body.To;
    // Parseo de numeros de telefono
    const fromColonIndex = from.indexOf(":");
    const toColonIndex = to.indexOf(":");
    // Numero de telefono que pasa de "whatsapp:+57XXXXXXXXX" a "+57XXXXXXXXX"
    const fromNumber = from.slice(fromColonIndex + 1); // Número del cliente
    const toNumber = to.slice(toColonIndex + 1);
    // fromNumber sin indicativo de país
    const fromNumberWithoutCountryCode = fromNumber.slice(3); // Número del cliente sin indicativo de país
    // Lista de números de Twilio para detectar mensajes salientes
    const twilioNumbers = [
        "+14155238886", // Número de pruebas
        "+5742044644", // Número de producción
    ];
    // Detectar mensajes salientes para evitar duplicación
    if (twilioNumbers.includes(fromNumber)) {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twiml.toString());
        return;
    }
    // 🔥 DETECTAR ASESOR BASADO EN EL NÚMERO DE TWILIO
    const advisor = await getAdvisorByTwilioNumber(toNumber);
    if (!advisor) {
        console.error(`❌ No advisor found for Twilio number: ${toNumber}`);
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twiml.toString());
        return;
    }
    console.log(`📞 Message for advisor: ${advisor.name} (${advisor.twilio_phone_number})`);
    exportedFromNumber = fromNumber;
    // Actualizar globalConfig para incluir advisor_id
    globalConfig = {
        configurable: {
            thread_id: `${advisor.id}_${fromNumber}`, // Hilo único por asesor+cliente
            phone_number: fromNumber,
            advisor_id: advisor.id
        },
    };
    try {
        let incomingMessage = ""; // Inicializar con string vacío
        let incomingImage;
        let firebaseImageUrl = "";
        let audioUrl = ""; // Para almacenar la URL del audio original
        let documentUrl = ""; // Para almacenar la URL del documento
        let vCardUrl = ""; // Para almacenar la URL del vCard
        // Logging consolidado del mensaje entrante
        console.log("📩 === PROCESSING INCOMING MESSAGE ===");
        console.log("From:", fromNumber);
        console.log("To:", toNumber);
        console.log("Message Body:", req.body.Body || "(empty)");
        console.log("Media Content Type:", req.body.MediaContentType0 || "none");
        console.log("Media URL:", req.body.MediaUrl0 || "none");
        console.log("Message SID:", req.body.MessageSid || "none");
        // Detectar origen de campaña
        const campaignOrigin = getCampaignOrigin(req.body);
        console.log("Campaign Origin:", campaignOrigin);
        console.log("========================================");
        if (req.body.MediaContentType0 &&
            req.body.MediaContentType0.includes("audio")) {
            try {
                const mediaUrl = req.body.MediaUrl0;
                const mediaContentType = req.body.MediaContentType0;
                console.log("Processing audio with content type:", mediaContentType);
                console.log("Audio URL:", mediaUrl);
                // Verificar que la URL de Twilio sea válida
                if (!mediaUrl || !mediaUrl.startsWith("https://api.twilio.com")) {
                    throw new Error("Invalid media URL from Twilio");
                }
                const response = await fetchMediaWithRetry(mediaUrl, {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                    },
                });
                // La función fetchMediaWithRetry ya maneja los errores y re-intentos
                // Solo verificamos que el buffer no esté vacío más adelante
                // Obtener el buffer del audio para subir a Firebase
                const audioBuffer = await response.buffer();
                // Verificar que el buffer no esté vacío
                if (!audioBuffer || audioBuffer.length === 0) {
                    throw new Error("Empty audio buffer received from Twilio");
                }
                console.log(`Audio buffer size: ${audioBuffer.length} bytes`);
                // Determinar la extensión del archivo basada en el content type
                let fileExtension = "ogg"; // Default para WhatsApp
                let actualContentType = mediaContentType;
                if (mediaContentType.includes("mpeg") ||
                    mediaContentType.includes("mp3")) {
                    fileExtension = "mp3";
                }
                else if (mediaContentType.includes("wav")) {
                    fileExtension = "wav";
                }
                else if (mediaContentType.includes("m4a")) {
                    fileExtension = "m4a";
                }
                else if (mediaContentType.includes("aac")) {
                    fileExtension = "aac";
                }
                else if (mediaContentType.includes("ogg")) {
                    fileExtension = "ogg";
                }
                else if (mediaContentType.includes("webm")) {
                    fileExtension = "webm";
                }
                // Crear un nuevo Buffer para la transcripción usando el mismo audioBuffer
                const audioBufferForTranscription = Buffer.from(audioBuffer);
                const file = await toFile(audioBufferForTranscription, `recording.${fileExtension}`);
                try {
                    const transcription = await openai.audio.transcriptions.create({
                        file,
                        model: "whisper-1",
                        prompt: "Por favor, transcribe el audio y asegúrate de escribir los números exactamente como se pronuncian, sin espacios, comas, ni puntos. Por ejemplo, un número de documento   debe ser transcrito como 123456789.",
                    });
                    const { text } = transcription;
                    incomingMessage = text || "Audio recibido"; // Fallback si no hay transcripción
                    console.log("Audio transcription successful:", text ? "✅" : "⚠️ (empty)");
                }
                catch (transcriptionError) {
                    console.error("Error in transcription:", transcriptionError);
                    incomingMessage = "Audio recibido (no se pudo transcribir)";
                }
                // Subir el audio original a Firebase Storage
                const audioName = `audio_${Date.now()}_${uuidv4().slice(0, 8)}.${fileExtension}`;
                const storageRef = ref(storage, `client-audios/${audioName}`);
                const metadata = {
                    contentType: actualContentType,
                    customMetadata: {
                        originalMimeType: mediaContentType,
                        fileSize: audioBuffer.length.toString(),
                        uploadedAt: new Date().toISOString(),
                        phoneNumber: fromNumber,
                        transcriptionStatus: incomingMessage.includes("no se pudo transcribir")
                            ? "failed"
                            : "success",
                    },
                };
                console.log(`Uploading audio: ${audioName} (${audioBuffer.length} bytes)`);
                // Función para subir el audio a Firebase Storage
                const uploadAudio = () => {
                    return new Promise((resolve, reject) => {
                        try {
                            const uploadTask = uploadBytesResumable(storageRef, audioBuffer, metadata);
                            uploadTask.on("state_changed", (snapshot) => {
                                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                                console.log(`Audio upload progress: ${progress.toFixed(2)}%`);
                            }, (error) => {
                                console.error("Firebase audio upload error:", error);
                                reject(`Audio upload failed: ${error.message}`);
                            }, async () => {
                                try {
                                    const audioUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    console.log(`Audio successfully uploaded to Firebase: ${audioUrl}`);
                                    // Verificar que la URL de Firebase sea válida
                                    if (!audioUrl ||
                                        !audioUrl.startsWith("https://firebasestorage.googleapis.com")) {
                                        throw new Error("Invalid Firebase URL generated for audio");
                                    }
                                    resolve(audioUrl);
                                }
                                catch (urlError) {
                                    console.error("Error getting audio download URL:", urlError);
                                    reject(`Failed to get audio download URL: ${urlError instanceof Error
                                        ? urlError.message
                                        : "Unknown error"}`);
                                }
                            });
                        }
                        catch (uploadError) {
                            console.error("Error starting audio upload:", uploadError);
                            reject(`Failed to start audio upload: ${uploadError instanceof Error
                                ? uploadError.message
                                : "Unknown error"}`);
                        }
                    });
                };
                // Subir el audio y obtener la URL
                audioUrl = await uploadAudio();
                console.log("Audio processing completed successfully");
            }
            catch (error) {
                console.error("❌ Error processing audio:", error);
                console.error("Audio error details:", {
                    mediaUrl: req.body.MediaUrl0,
                    mediaContentType: req.body.MediaContentType0,
                    errorMessage: error instanceof Error ? error.message : "Unknown error",
                });
                incomingMessage = "Audio recibido (error en procesamiento)";
                audioUrl = "";
                // No enviar respuesta aquí, continuar con el flujo
            }
        }
        else if (req.body.MediaContentType0 &&
            req.body.MediaContentType0.includes("image")) {
            try {
                const mediaUrl = req.body.MediaUrl0;
                const mediaContentType = req.body.MediaContentType0;
                console.log("Processing image with content type:", mediaContentType);
                console.log("Image URL:", mediaUrl);
                // Verificar que la URL de Twilio sea válida
                if (!mediaUrl || !mediaUrl.startsWith("https://api.twilio.com")) {
                    throw new Error("Invalid media URL from Twilio");
                }
                const response = await fetchMediaWithRetry(mediaUrl, {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                    },
                });
                // La función fetchMediaWithRetry ya maneja los errores y re-intentos
                // Solo verificamos que el buffer no esté vacío más adelante
                // Obtener el buffer de la imagen
                const imageBuffer = await response.buffer();
                // Verificar que el buffer no esté vacío
                if (!imageBuffer || imageBuffer.length === 0) {
                    throw new Error("Empty image buffer received from Twilio");
                }
                console.log(`Image buffer size: ${imageBuffer.length} bytes`);
                // Determinar la extensión del archivo basada en el content type
                let fileExtension = "jpg"; // Default
                let actualContentType = mediaContentType;
                if (mediaContentType.includes("png")) {
                    fileExtension = "png";
                }
                else if (mediaContentType.includes("gif")) {
                    fileExtension = "gif";
                }
                else if (mediaContentType.includes("webp")) {
                    fileExtension = "webp";
                }
                else if (mediaContentType.includes("jpeg") ||
                    mediaContentType.includes("jpg")) {
                    fileExtension = "jpg";
                }
                else if (mediaContentType.includes("bmp")) {
                    fileExtension = "bmp";
                }
                else if (mediaContentType.includes("tiff")) {
                    fileExtension = "tiff";
                }
                // Convertir la imagen a base64 con el tipo correcto
                const imageBase64 = imageBuffer.toString("base64");
                // Crear el nombre del archivo en Firebase Storage
                const imageName = `image_${Date.now()}_${uuidv4().slice(0, 8)}.${fileExtension}`;
                const storageRef = ref(storage, `images/${imageName}`);
                const metadata = {
                    contentType: actualContentType,
                    customMetadata: {
                        originalMimeType: mediaContentType,
                        fileSize: imageBuffer.length.toString(),
                        uploadedAt: new Date().toISOString(),
                        phoneNumber: fromNumber,
                    },
                };
                console.log(`Uploading image: ${imageName} (${imageBuffer.length} bytes)`);
                // Función para subir la imagen a Firebase Storage
                const uploadImage = () => {
                    return new Promise((resolve, reject) => {
                        try {
                            const uploadTask = uploadBytesResumable(storageRef, imageBuffer, metadata);
                            uploadTask.on("state_changed", (snapshot) => {
                                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                                console.log(`Image upload progress: ${progress.toFixed(2)}%`);
                            }, (error) => {
                                console.error("Firebase image upload error:", error);
                                reject(`Image upload failed: ${error.message}`);
                            }, async () => {
                                try {
                                    const imageUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    console.log(`Image successfully uploaded to Firebase: ${imageUrl}`);
                                    // Verificar que la URL de Firebase sea válida
                                    if (!imageUrl ||
                                        !imageUrl.startsWith("https://firebasestorage.googleapis.com")) {
                                        throw new Error("Invalid Firebase URL generated for image");
                                    }
                                    resolve(imageUrl);
                                }
                                catch (urlError) {
                                    console.error("Error getting image download URL:", urlError);
                                    reject(`Failed to get image download URL: ${urlError instanceof Error
                                        ? urlError.message
                                        : "Unknown error"}`);
                                }
                            });
                        }
                        catch (uploadError) {
                            console.error("Error starting image upload:", uploadError);
                            reject(`Failed to start image upload: ${uploadError instanceof Error
                                ? uploadError.message
                                : "Unknown error"}`);
                        }
                    });
                };
                const uploadedImageUrl = await uploadImage();
                firebaseImageUrl = uploadedImageUrl;
                incomingMessage = req.body.Body || "Imagen recibida";
                const base64DataUrl = `data:${actualContentType};base64,${imageBase64}`;
                incomingImage = base64DataUrl;
                console.log("Image processing completed successfully");
            }
            catch (error) {
                console.error("❌ Error processing image:", error);
                console.error("Image error details:", {
                    mediaUrl: req.body.MediaUrl0,
                    mediaContentType: req.body.MediaContentType0,
                    errorMessage: error instanceof Error ? error.message : "Unknown error",
                });
                incomingMessage = "Imagen recibida (error en procesamiento)";
                firebaseImageUrl = "";
            }
        }
        else if (req.body.MediaContentType0 &&
            (req.body.MediaContentType0.includes("text/x-vcard") ||
                req.body.MediaContentType0.includes("text/vcard"))) {
            // Manejar contactos de WhatsApp (vCard)
            try {
                const mediaUrl = req.body.MediaUrl0;
                const mediaContentType = req.body.MediaContentType0;
                console.log("Processing vCard contact with content type:", mediaContentType);
                console.log("vCard URL:", mediaUrl);
                // Verificar que la URL de Twilio sea válida
                if (!mediaUrl || !mediaUrl.startsWith("https://api.twilio.com")) {
                    throw new Error("Invalid media URL from Twilio");
                }
                const response = await fetchMediaWithRetry(mediaUrl, {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                    },
                });
                // La función fetchMediaWithRetry ya maneja los errores y re-intentos
                // Solo verificamos que el contenido no esté vacío más adelante
                // Obtener el contenido del vCard
                const vCardContent = await response.text();
                // Verificar que el contenido no esté vacío
                if (!vCardContent || vCardContent.trim() === "") {
                    throw new Error("Empty vCard content received from Twilio");
                }
                console.log(`vCard content size: ${vCardContent.length} characters`);
                // Procesar el contenido del vCard para extraer información
                let contactName = "Contacto";
                let contactPhone = "";
                let contactEmail = "";
                let contactOrg = "";
                try {
                    // Extraer información básica del vCard usando regex
                    const fnMatch = vCardContent.match(/FN[;:](.+)/i);
                    if (fnMatch) {
                        contactName = fnMatch[1].trim();
                    }
                    const telMatch = vCardContent.match(/TEL[^:]*:(.+)/i);
                    if (telMatch) {
                        contactPhone = telMatch[1].trim();
                    }
                    const emailMatch = vCardContent.match(/EMAIL[^:]*:(.+)/i);
                    if (emailMatch) {
                        contactEmail = emailMatch[1].trim();
                    }
                    const orgMatch = vCardContent.match(/ORG[;:](.+)/i);
                    if (orgMatch) {
                        contactOrg = orgMatch[1].trim();
                    }
                    console.log("Parsed vCard info:", {
                        name: contactName,
                        phone: contactPhone,
                        email: contactEmail,
                        org: contactOrg,
                    });
                }
                catch (parseError) {
                    console.warn("Error parsing vCard content:", parseError);
                    // Continuar con valores por defecto
                }
                // Crear el nombre del archivo en Firebase Storage
                const vCardName = `vcard_${Date.now()}_${uuidv4().slice(0, 8)}.vcf`;
                const storageRef = ref(storage, `contacts/${vCardName}`);
                // Convertir el contenido a Buffer para Firebase
                const vCardBuffer = Buffer.from(vCardContent, "utf8");
                const metadata = {
                    contentType: mediaContentType,
                    customMetadata: {
                        originalMimeType: mediaContentType,
                        detectedFileType: "vCard",
                        contactName: contactName,
                        contactPhone: contactPhone,
                        contactEmail: contactEmail,
                        contactOrg: contactOrg,
                        fileSize: vCardBuffer.length.toString(),
                        uploadedAt: new Date().toISOString(),
                        phoneNumber: fromNumber,
                    },
                };
                console.log(`Uploading vCard: ${vCardName} (${vCardBuffer.length} bytes)`);
                // Función para subir el vCard a Firebase Storage
                const uploadVCard = () => {
                    return new Promise((resolve, reject) => {
                        try {
                            const uploadTask = uploadBytesResumable(storageRef, vCardBuffer, metadata);
                            uploadTask.on("state_changed", (snapshot) => {
                                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                                console.log(`vCard upload progress: ${progress.toFixed(2)}%`);
                            }, (error) => {
                                console.error("Firebase vCard upload error:", error);
                                reject(`vCard upload failed: ${error.message}`);
                            }, async () => {
                                try {
                                    const vCardUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    console.log(`vCard successfully uploaded to Firebase: ${vCardUrl}`);
                                    // Verificar que la URL de Firebase sea válida
                                    if (!vCardUrl ||
                                        !vCardUrl.startsWith("https://firebasestorage.googleapis.com")) {
                                        throw new Error("Invalid Firebase URL generated for vCard");
                                    }
                                    resolve(vCardUrl);
                                }
                                catch (urlError) {
                                    console.error("Error getting vCard download URL:", urlError);
                                    reject(`Failed to get vCard download URL: ${urlError instanceof Error
                                        ? urlError.message
                                        : "Unknown error"}`);
                                }
                            });
                        }
                        catch (uploadError) {
                            console.error("Error starting vCard upload:", uploadError);
                            reject(`Failed to start vCard upload: ${uploadError instanceof Error
                                ? uploadError.message
                                : "Unknown error"}`);
                        }
                    });
                };
                // Subir el vCard y obtener la URL
                vCardUrl = await uploadVCard();
                console.log("vCard uploaded to Firebase successfully:", vCardUrl);
                // Crear un mensaje más descriptivo basado en la información extraída
                let contactInfo = `Contacto compartido: ${contactName}`;
                if (contactPhone)
                    contactInfo += ` - Tel: ${contactPhone}`;
                if (contactEmail)
                    contactInfo += ` - Email: ${contactEmail}`;
                if (contactOrg)
                    contactInfo += ` - ${contactOrg}`;
                incomingMessage = req.body.Body || contactInfo;
                console.log("vCard processing completed successfully");
            }
            catch (error) {
                console.error("❌ Error processing vCard:", error);
                console.error("vCard error details:", {
                    mediaUrl: req.body.MediaUrl0,
                    mediaContentType: req.body.MediaContentType0,
                    errorMessage: error instanceof Error ? error.message : "Unknown error",
                });
                incomingMessage = "Contacto recibido (error en procesamiento)";
                vCardUrl = "";
            }
        }
        else if (req.body.MediaContentType0 && req.body.MediaUrl0) {
            // Manejar otros tipos de archivos (documentos, videos, etc.)
            try {
                const mediaUrl = req.body.MediaUrl0;
                const mediaContentType = req.body.MediaContentType0;
                console.log("Processing file with content type:", mediaContentType);
                console.log("Media URL:", mediaUrl);
                console.log("Original filename:", req.body.MediaFileName0);
                // Verificar que la URL de Twilio sea válida
                if (!mediaUrl || !mediaUrl.startsWith("https://api.twilio.com")) {
                    throw new Error("Invalid media URL from Twilio");
                }
                let response;
                let fileBuffer;
                // Manejo especial para archivos Excel
                if (mediaContentType.includes("excel") ||
                    mediaContentType.includes("spreadsheet")) {
                    console.log("🔄 Processing Excel file with special handling...");
                    // Configuración especial para archivos Excel con re-intento
                    response = await fetchMediaWithRetry(mediaUrl, {
                        headers: {
                            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                            Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, */*",
                            "User-Agent": "WhatsApp-FileProcessor/1.0",
                        },
                    });
                    // La función fetchMediaWithRetry ya maneja los errores y re-intentos
                    // Verificar el Content-Type de la respuesta real
                    const actualContentType = response.headers.get("content-type");
                    const contentLength = response.headers.get("content-length");
                    console.log("Expected MIME type:", mediaContentType);
                    console.log("Actual MIME type from Twilio:", actualContentType);
                    console.log("Content-Length from Twilio:", contentLength);
                    // Obtener el buffer con manejo especial para Excel
                    fileBuffer = await response.buffer();
                    // Validaciones específicas para Excel
                    console.log(`Excel file buffer size: ${fileBuffer.length} bytes`);
                    // Verificar tamaño vs Content-Length
                    if (contentLength && parseInt(contentLength) !== fileBuffer.length) {
                        console.error("⚠️  SIZE MISMATCH for Excel file!");
                        console.error(`Expected: ${contentLength} bytes, Got: ${fileBuffer.length} bytes`);
                        throw new Error(`Excel file size mismatch: expected ${contentLength}, got ${fileBuffer.length}`);
                    }
                    // Un archivo Excel válido debe tener al menos ciertos bytes iniciales
                    if (fileBuffer.length < 512) {
                        throw new Error(`Excel file too small (${fileBuffer.length} bytes), likely corrupted`);
                    }
                    // Verificar que comience con los magic bytes de un archivo ZIP (Excel es un ZIP)
                    const magicBytes = fileBuffer.slice(0, 4);
                    const isValidZip = magicBytes[0] === 0x50 && magicBytes[1] === 0x4b;
                    console.log("File magic bytes:", Array.from(magicBytes)
                        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
                        .join(" "));
                    if (!isValidZip) {
                        console.error("❌ Excel file does not start with ZIP magic bytes");
                        throw new Error("Excel file appears to be corrupted - invalid file signature");
                    }
                    console.log("✅ Excel file passed basic validation checks");
                }
                else {
                    // Manejo normal para otros tipos de archivo con re-intento
                    response = await fetchMediaWithRetry(mediaUrl, {
                        headers: {
                            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                        },
                    });
                    // La función fetchMediaWithRetry ya maneja los errores y re-intentos
                    // Obtener el buffer del archivo
                    fileBuffer = await response.buffer();
                }
                // Verificar que el buffer no esté vacío (aplica a todos los archivos)
                if (!fileBuffer || fileBuffer.length === 0) {
                    throw new Error("Empty file buffer received from Twilio");
                }
                console.log(`File buffer size: ${fileBuffer.length} bytes`);
                // Determinar la extensión del archivo basada en el content type
                let fileExtension = "";
                if (mediaContentType.includes("pdf")) {
                    fileExtension = "pdf";
                }
                else if (mediaContentType.includes("spreadsheetml.sheet") ||
                    mediaContentType.includes("vnd.ms-excel")) {
                    // Archivos Excel (.xlsx, .xls)
                    fileExtension = "xlsx";
                }
                else if (mediaContentType.includes("word") ||
                    mediaContentType.includes("wordprocessingml.document")) {
                    // Archivos Word (.docx, .doc)
                    fileExtension = "docx";
                }
                else if (mediaContentType.includes("presentationml.presentation") ||
                    mediaContentType.includes("vnd.ms-powerpoint")) {
                    // Archivos PowerPoint (.pptx, .ppt)
                    fileExtension = "pptx";
                }
                else if (mediaContentType.includes("video")) {
                    // Videos (.mp4, .avi, .mov, etc.)
                    fileExtension = "mp4";
                }
                else if (mediaContentType.includes("image")) {
                    // Imágenes que no se procesaron antes (.png, .gif, .webp, etc.)
                    const imageParts = mediaContentType.split("/");
                    fileExtension = imageParts[1] || "jpg";
                }
                else if (mediaContentType.includes("text/plain")) {
                    // Archivos de texto (.txt)
                    fileExtension = "txt";
                }
                else if (mediaContentType.includes("text/csv") ||
                    mediaContentType.includes("comma-separated-values")) {
                    // Archivos CSV
                    fileExtension = "csv";
                }
                else if (mediaContentType.includes("application/zip")) {
                    // Archivos ZIP
                    fileExtension = "zip";
                }
                else if (mediaContentType.includes("application/x-rar") ||
                    mediaContentType.includes("application/vnd.rar")) {
                    // Archivos RAR
                    fileExtension = "rar";
                }
                else if (mediaContentType.includes("audio")) {
                    // Archivos de audio que no se procesaron antes (.mp3, .wav, .m4a, etc.)
                    const audioParts = mediaContentType.split("/");
                    fileExtension = audioParts[1] || "mp3";
                }
                else {
                    // Fallback genérico
                    fileExtension = mediaContentType.split("/")[1] || "bin";
                }
                // Crear el nombre del archivo en Firebase Storage
                const originalFileName = req.body.MediaFileName0 || "documento";
                const timestamp = Date.now();
                const fileName = `document_${timestamp}_${uuidv4().slice(0, 8)}.${fileExtension}`;
                const storageRef = ref(storage, `documents/${fileName}`);
                // Determinar el tipo detectado para metadatos
                let detectedFileType = "unknown";
                if (mediaContentType.includes("pdf")) {
                    detectedFileType = "PDF";
                }
                else if (mediaContentType.includes("spreadsheetml.sheet") ||
                    mediaContentType.includes("vnd.ms-excel") ||
                    mediaContentType.includes("excel") ||
                    mediaContentType.includes("sheet")) {
                    detectedFileType = "Excel";
                }
                else if (mediaContentType.includes("word") ||
                    mediaContentType.includes("wordprocessingml.document")) {
                    detectedFileType = "Word";
                }
                else if (mediaContentType.includes("presentationml.presentation") ||
                    mediaContentType.includes("vnd.ms-powerpoint")) {
                    detectedFileType = "PowerPoint";
                }
                else if (mediaContentType.includes("video")) {
                    detectedFileType = "Video";
                }
                else if (mediaContentType.includes("image")) {
                    detectedFileType = "Image";
                }
                else if (mediaContentType.includes("text/plain")) {
                    detectedFileType = "Text";
                }
                else if (mediaContentType.includes("text/csv") ||
                    mediaContentType.includes("comma-separated-values")) {
                    detectedFileType = "CSV";
                }
                else if (mediaContentType.includes("application/zip")) {
                    detectedFileType = "ZIP";
                }
                else if (mediaContentType.includes("application/x-rar") ||
                    mediaContentType.includes("application/vnd.rar")) {
                    detectedFileType = "RAR";
                }
                else if (mediaContentType.includes("audio")) {
                    detectedFileType = "Audio";
                }
                else {
                    detectedFileType = "Generic";
                }
                console.log(`File detected as: ${detectedFileType} with extension: ${fileExtension}`);
                console.log(`Full MIME type: ${mediaContentType}`);
                // Usar el MIME type original para preservar la integridad del archivo
                const metadata = {
                    contentType: mediaContentType,
                    customMetadata: {
                        originalMimeType: mediaContentType,
                        detectedFileType: detectedFileType,
                        originalFilename: originalFileName,
                        fileSize: fileBuffer.length.toString(),
                        uploadedAt: new Date().toISOString(),
                        phoneNumber: fromNumber,
                        // Para archivos Excel, agregar información adicional
                        ...(detectedFileType === "Excel" && {
                            excelValidation: "passed",
                            hasZipSignature: "true",
                        }),
                    },
                };
                console.log(`Uploading file: ${fileName} (${fileBuffer.length} bytes)`);
                // Función mejorada para subir el archivo a Firebase Storage
                const uploadFile = () => {
                    return new Promise((resolve, reject) => {
                        try {
                            const uploadTask = uploadBytesResumable(storageRef, fileBuffer, metadata);
                            uploadTask.on("state_changed", (snapshot) => {
                                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                                console.log(`Upload progress: ${progress.toFixed(2)}%`);
                            }, (error) => {
                                console.error("Firebase upload error:", error);
                                reject(`File upload failed: ${error.message}`);
                            }, async () => {
                                try {
                                    const fileUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    console.log(`File successfully uploaded to Firebase: ${fileUrl}`);
                                    // Verificar que la URL de Firebase sea válida
                                    if (!fileUrl ||
                                        !fileUrl.startsWith("https://firebasestorage.googleapis.com")) {
                                        throw new Error("Invalid Firebase URL generated");
                                    }
                                    resolve(fileUrl);
                                }
                                catch (urlError) {
                                    console.error("Error getting download URL:", urlError);
                                    reject(`Failed to get download URL: ${urlError instanceof Error
                                        ? urlError.message
                                        : "Unknown error"}`);
                                }
                            });
                        }
                        catch (uploadError) {
                            console.error("Error starting upload:", uploadError);
                            reject(`Failed to start upload: ${uploadError instanceof Error
                                ? uploadError.message
                                : "Unknown error"}`);
                        }
                    });
                };
                // Subir el archivo y obtener la URL
                documentUrl = await uploadFile();
                console.log("File uploaded to Firebase successfully:", documentUrl);
                incomingMessage =
                    req.body.Body ||
                        `Archivo ${detectedFileType} recibido: ${originalFileName}`;
            }
            catch (error) {
                console.error("❌ Error processing file:", error);
                console.error("Error details:", {
                    mediaUrl: req.body.MediaUrl0,
                    mediaContentType: req.body.MediaContentType0,
                    fileName: req.body.MediaFileName0,
                    errorMessage: error instanceof Error ? error.message : "Unknown error",
                });
                incomingMessage = "Archivo recibido (error en procesamiento)";
                // No establecer documentUrl si hubo error
                documentUrl = "";
            }
        }
        else {
            incomingMessage = req.body.Body || "Mensaje recibido";
        }
        // Capturar el SID del mensaje entrante de Twilio
        const incomingMessageSid = req.body.MessageSid || req.body.SmsMessageSid || null;
        // Primero guardar el mensaje (esto creará la conversación si no existe)
        let incomingMessageId;
        if (audioUrl) {
            incomingMessageId = await saveChatHistory(fromNumber, incomingMessage, true, audioUrl, undefined, campaignOrigin, undefined, // fileName
            advisor.id // advisor_id
            );
        }
        else if (vCardUrl) {
            incomingMessageId = await saveChatHistory(fromNumber, incomingMessage, true, vCardUrl, undefined, campaignOrigin, undefined, // fileName
            advisor.id // advisor_id
            );
        }
        else if (documentUrl) {
            incomingMessageId = await saveChatHistory(fromNumber, incomingMessage, true, documentUrl, undefined, campaignOrigin, undefined, // fileName
            advisor.id // advisor_id
            );
        }
        else {
            incomingMessageId = await saveChatHistory(fromNumber, incomingMessage, true, firebaseImageUrl, undefined, campaignOrigin, undefined, // fileName
            advisor.id // advisor_id
            );
        }
        // Actualizar con el SID del mensaje entrante
        if (incomingMessageId && incomingMessageSid) {
            await updateMessageTwilioSid(incomingMessageId, incomingMessageSid);
        }
        // AHORA consultar el estado específico para este asesor
        const chatOn = await getAvailableChatOn(fromNumber, advisor.id);
        console.log(`🔍 Chat On validation result for advisor ${advisor.name}:`, chatOn);
        // 🚨 VALIDACIÓN CRÍTICA: Solo proceder con IA si chatOn es explícitamente FALSE
        if (chatOn === true) {
            console.log("👤 HUMAN ATTENTION MODE - Stopping AI processing");
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
            return;
        }
        else if (chatOn === null) {
            console.log("⚠️ WARNING: chatOn is null - No conversation found, defaulting to HUMAN attention");
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
            return;
        }
        // Si llegamos aquí, chatOn es explícitamente FALSE = atención por IA
        console.log("🤖 AI ATTENTION MODE - Processing with AI");
        // Verificar que incomingMessage no esté vacío antes de procesar con IA
        if (!incomingMessage || incomingMessage.trim() === "") {
            console.error("Incoming message is empty, cannot process with AI");
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
            return;
        }
        // configuración para crear hilos de conversación en el agente y manejar memorias independientes por asesor
        const config = {
            configurable: {
                thread_id: `${advisor.id}_${fromNumber}`, // Usar el mismo thread_id que globalConfig
                phone_number: fromNumber,
                advisor_id: advisor.id
            },
        };
        let agentOutput;
        if (incomingImage) {
            const message = new HumanMessage({
                content: [
                    {
                        type: "image_url",
                        image_url: { url: incomingImage },
                    },
                ],
            });
            agentOutput = await appWithMemory.invoke({
                messages: [message],
            }, config);
        }
        else {
            agentOutput = await appWithMemory.invoke({
                messages: [new HumanMessage(incomingMessage)],
            }, config);
        }
        const lastMessage = agentOutput.messages[agentOutput.messages.length - 1];
        if (!lastMessage || typeof lastMessage.content !== "string") {
            console.error("Error: El mensaje de la IA es nulo o no es un string.");
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
            return;
        }
        const responseMessage = lastMessage.content;
        console.log("Respuesta IA:", responseMessage);
        // 🔍 VALIDACIÓN: Mostrar a qué número se enviará la respuesta
        console.log("📤 === AI RESPONSE ROUTING INFO ===");
        console.log("Asesor:", advisor.name, `(ID: ${advisor.id})`);
        console.log("Número del asesor:", advisor.twilio_phone_number);
        console.log("Cliente destinatario:", fromNumber);
        console.log("Respuesta se enviará FROM:", toNumber, "TO:", fromNumber);
        console.log("====================================");
        // Ejecutar la función si el mensaje es del agente
        const messageId = await saveChatHistory(fromNumber, responseMessage, false, "", undefined, undefined, undefined, // fileName
        advisor.id // advisor_id
        );
        //consultar si esta disponible para audios específico para este asesor
        const isAvailableForAudio = await getAvailableForAudio(fromNumber, advisor.id);
        // Si la respuesta es menor a 400 caracteres && no contiene números, hacer TTS y enviar el audio
        if (responseMessage.length <= 400 &&
            !/\d/.test(responseMessage) &&
            !/\b(?:[A-Z]{2,}|\b(?:[A-Z]\.){2,}[A-Z]?)\b/.test(responseMessage) &&
            !/\//.test(responseMessage) &&
            isAvailableForAudio) {
            console.log("Entró a enviar audio");
            try {
                const audioBuffer = await createAudioStreamFromText(responseMessage);
                const audioName = `${uuidv4()}.wav`;
                const storageRef = ref(storage, `audios/${audioName}`);
                const metadata = {
                    contentType: "audio/mpeg",
                };
                const uploadTask = uploadBytesResumable(storageRef, audioBuffer, metadata);
                uploadTask.on("state_changed", (snapshot) => {
                    console.log("Upload is in progress...");
                }, (error) => {
                    throw new Error(`Upload failed: ${error.message}`);
                }, async () => {
                    const audioUrl = await getDownloadURL(uploadTask.snapshot.ref);
                    const randomDelay = getRandomDelay(15000, 25000); // Espera entre 15 y 25 segundos
                    console.log(`⏳ Delaying audio response by ${randomDelay / 1000} seconds...`);
                    await delay(randomDelay);
                    console.log("🎵 === SENDING AUDIO MESSAGE ===");
                    console.log("Audio FROM:", to, "TO:", from);
                    console.log("Asesor responsable:", advisor.name, `(${advisor.twilio_phone_number})`);
                    console.log("================================");
                    const message = await client.messages.create({
                        body: "Audio message",
                        from: to,
                        to: from,
                        mediaUrl: [audioUrl],
                        statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
                    });
                    // Actualizar el mensaje de la IA con el SID del audio enviado
                    if (messageId && message.sid) {
                        await updateMessageTwilioSid(messageId, message.sid);
                    }
                    console.log("Audio message sent successfully");
                    res.writeHead(200, { "Content-Type": "text/xml" });
                    res.end(twiml.toString());
                });
            }
            catch (error) {
                console.error("Error sending audio message:", error);
                twiml.message(responseMessage);
                res.writeHead(200, { "Content-Type": "text/xml" });
                res.end(twiml.toString());
            }
        }
        else {
            // Responder con texto
            if (responseMessage.length > 1000) {
                console.log("Response is too long, splitting by newline");
                const messageParts = responseMessage.split("\n\n");
                for (let part of messageParts) {
                    if (part !== "") {
                        const partMessageId = await saveChatHistory(fromNumber, part, false, "");
                        const randomDelay = getRandomDelay(15000, 25000); // Espera entre 15 y 25 segundos
                        console.log(`⏳ Delaying audio response by ${randomDelay / 1000} seconds...`);
                        await delay(randomDelay);
                        console.log("💬 === SENDING TEXT MESSAGE ===");
                        console.log("Text FROM:", to, "TO:", from);
                        console.log("Asesor responsable:", advisor.name, `(${advisor.twilio_phone_number})`);
                        console.log("Message part:", part.substring(0, 50) + "...");
                        console.log("===============================");
                        const message = await client.messages.create({
                            body: part,
                            from: to,
                            to: from,
                            statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
                        });
                        console.log(part);
                        console.log("-------------------");
                        if (partMessageId && message.sid) {
                            await updateMessageTwilioSid(partMessageId, message.sid);
                        }
                    }
                }
            }
            else {
                try {
                    const randomDelay = getRandomDelay(15000, 25000); // Espera entre 15 y 25 segundos
                    console.log(`⏳ Delaying audio response by ${randomDelay / 1000} seconds...`);
                    await delay(randomDelay);
                    console.log("💬 === SENDING SINGLE TEXT MESSAGE ===");
                    console.log("Text FROM:", to, "TO:", from);
                    console.log("Asesor responsable:", advisor.name, `(${advisor.twilio_phone_number})`);
                    console.log("Message:", responseMessage.substring(0, 100) + "...");
                    console.log("====================================");
                    const message = await client.messages.create({
                        body: responseMessage,
                        from: to,
                        to: from,
                        statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
                    });
                    console.log("Message sent successfully:", message.sid);
                    if (messageId && message.sid) {
                        await updateMessageTwilioSid(messageId, message.sid);
                    }
                }
                catch (error) {
                    console.error("Error sending message:", error);
                }
            }
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
        }
        // Logging consolidado de finalización exitosa
        console.log("✅ === MESSAGE PROCESSING COMPLETED ===");
        console.log("From:", fromNumber);
        console.log("Final Message:", incomingMessage.substring(0, 100) +
            (incomingMessage.length > 100 ? "..." : ""));
        console.log("Media URLs:", {
            audio: audioUrl ? "✅ uploaded" : "❌ none",
            image: firebaseImageUrl ? "✅ uploaded" : "❌ none",
            document: documentUrl ? "✅ uploaded" : "❌ none",
            vcard: vCardUrl ? "✅ vCard processed" : "❌ none",
        });
        console.log("Chat Mode:", chatOn === false ? "🤖 AI" : "👤 Human");
        console.log("==========================================");
    }
    catch (error) {
        console.error("❌ === CRITICAL ERROR IN CHAT ROUTE ===");
        console.error("From:", fromNumber || "unknown");
        console.error("Error Type:", error instanceof Error ? error.constructor.name : "Unknown");
        console.error("Error Message:", error instanceof Error ? error.message : "An unknown error occurred");
        console.error("Error Stack:", error instanceof Error ? error.stack : "No stack trace");
        console.error("Request Details:", {
            body: req.body.Body || "empty",
            mediaType: req.body.MediaContentType0 || "none",
            mediaUrl: req.body.MediaUrl0 || "none",
            messageSid: req.body.MessageSid || "none",
        });
        console.error("======================================");
        // Solo enviar respuesta de error si no se ha enviado ya
        if (!res.headersSent) {
            res.status(500).send({
                error: error instanceof Error ? error.message : "An unknown error occurred",
            });
        }
    }
});
router.post("/asadores/chat-dashboard", async (req, res) => {
    try {
        const twiml = new MessagingResponse();
        const { clientNumber, newMessage, userName, fileName, advisorId, twilioPhoneNumber } = req.body;
        const isAudioMessage = await newMessage.includes("https://firebasestorage.googleapis.com/v0/b/ultim-admin-dashboard.appspot.com/o/audios");
        const isFileMessage = await newMessage.includes("https://firebasestorage.googleapis.com/v0/b/ultim-admin-dashboard.appspot.com/o/documents");
        console.log("📎 Dashboard message - isFileMessage:", isFileMessage, "fileName:", fileName || "not provided");
        if (isAudioMessage) {
            console.log("Audio message detected");
            // Descargar el archivo desde Firebase
            const audioUrl = newMessage;
            const response = await fetch(audioUrl);
            const audioBuffer = await response.buffer();
            const tempDir = path.join(__dirname, "../tmp"); // Subir un nivel desde routes
            const tempInputPath = path.join(tempDir, "tempInput.webm");
            const tempOutputPath = path.join(tempDir, "tempOutput.mp3");
            // Guardar el archivo temporal
            fs.writeFileSync(tempInputPath, new Uint8Array(audioBuffer));
            // Convertir a formato OGG usando ffmpeg
            await new Promise((resolve, reject) => {
                ffmpeg(tempInputPath)
                    .output(tempOutputPath)
                    .inputOptions("-f", "webm")
                    .audioCodec("libmp3lame")
                    .on("start", (commandLine) => {
                    console.log("Comando FFmpeg:", commandLine);
                })
                    .on("end", resolve)
                    .on("error", reject)
                    .run();
            });
            // Subir el audio convertido a Firebase Storage a la capeta audios
            const audioName = `audio_${uuidv4()}.mp3`;
            const storageRef = ref(storage, `ogg/${audioName}`);
            const metadata = {
                contentType: "audio/mpeg",
            };
            const uploadTask = uploadBytesResumable(storageRef, fs.readFileSync(tempOutputPath), metadata);
            console.log("Nombre creado", audioName);
            // Esperar a que la subida complete y obtener la URL pública
            uploadTask.on("state_changed", (snapshot) => {
                // Progreso de la subida (opcional)
                console.log("Upload is in progress...");
            }, (error) => {
                throw new Error(`Upload failed: ${error.message}`);
            }, async () => {
                // Subida completada
                const audioUrl = await getDownloadURL(uploadTask.snapshot.ref);
                console.log("Audio URL:", audioUrl);
                // Guardar el mensaje con la URL original del dashboard
                const messageId = await saveChatHistory(clientNumber, "Audio message", false, newMessage, // URL original del dashboard
                userName, undefined, // origin
                undefined, // fileName
                advisorId // advisor_id
                );
                // Envía el archivo de audio a través de Twilio
                const message = await client.messages.create({
                    body: "Audio message",
                    to: `whatsapp:${clientNumber}`,
                    // from: "whatsapp:+5742044644",
                    // from: `whatsapp:+14155238886`,
                    from: `whatsapp:${twilioPhoneNumber}`,
                    mediaUrl: [audioUrl],
                    statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
                });
                // Actualizar con el SID de Twilio
                if (messageId && message.sid) {
                    await updateMessageTwilioSid(messageId, message.sid);
                }
                // Limpiar archivos temporales
                fs.unlinkSync(tempInputPath);
                fs.unlinkSync(tempOutputPath);
                console.log("Audio message sent successfully", audioUrl);
                res.writeHead(200, { "Content-Type": "text/xml" });
                res.end(twiml.toString());
            });
        }
        else if (isFileMessage) {
            console.log("File message detected");
            // Guardar el mensaje primero
            console.log("💾 Saving file message with fileName:", fileName);
            const messageId = await saveChatHistory(clientNumber, "Archivo enviado", false, newMessage, userName, undefined, fileName, // Solo para file messages se pasa el fileName
            advisorId // advisor_id
            );
            const message = await client.messages.create({
                // body: 'Mensaje con archivo',
                to: `whatsapp:${clientNumber}`,
                // from: "whatsapp:+5742044644",
                // from: `whatsapp:+14155238886`,
                from: `whatsapp:${twilioPhoneNumber}`,
                mediaUrl: [newMessage],
                statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
            });
            // Actualizar con el SID de Twilio
            if (messageId && message.sid) {
                await updateMessageTwilioSid(messageId, message.sid);
            }
            console.log("File message sent successfully:", message.sid);
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(twiml.toString());
        }
        else {
            // Guardar el mensaje primero
            const messageId = await saveChatHistory(clientNumber, newMessage, false, "", userName, undefined, undefined, // fileName
            advisorId // advisor_id
            );
            // Enviar mensaje a través de Twilio
            const message = await client.messages.create({
                // from: "whatsapp:+5742044644",
                // from: `whatsapp:+14155238886`,
                from: `whatsapp:${twilioPhoneNumber}`,
                to: `whatsapp:${clientNumber}`,
                body: newMessage,
                statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
            });
            // Actualizar con el SID de Twilio
            if (messageId && message.sid) {
                await updateMessageTwilioSid(messageId, message.sid);
            }
            // Enviar respuesta al frontend
            res.status(200).send({
                success: true,
                message: "Mensaje enviado exitosamente",
                sid: message.sid,
            });
        }
    }
    catch (error) {
        console.error("Error in chat route:", error);
        res.status(500).send({
            error: error instanceof Error ? error.message : "An unknown error occurred",
        });
    }
});
// Ruta para enviar una plantilla de WhatsApp
router.post("/asadores/send-template", async (req, res) => {
    const { to, templateId, name, agentName, user, advisorId, twilioPhoneNumber } = req.body; // Agregar advisorId
    try {
        const message = await client.messages.create({
            // from: "whatsapp:+5742044644",
            // from: `whatsapp:+14155238886`,
            from: `whatsapp:${twilioPhoneNumber}`,
            to: `whatsapp:${to}`,
            contentSid: templateId,
            // messagingServiceSid: "MGe5ebd75ff86ad20dbe6c0c1d09bfc081",
            contentVariables: JSON.stringify({ 1: name, 2: agentName }),
            statusCallback: `${statusCallbackUrl}/asadores/webhook/status`,
        });
        console.log("body", message.body);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // Traer el mensaje de la plantilla desde el endpoint /message/:sid con axios
        const response = await axios.get(`https://ultim.online/asadores/message/${message.sid}`);
        console.log("response", response.data.message.body);
        // Guardar el mensaje en la base de datos con advisor específico
        const messageId = await saveTemplateChatHistory(to, response.data.message.body, false, "", user, advisorId // Pasar advisorId para asociar plantilla al asesor correcto
        );
        if (messageId && message.sid) {
            await updateMessageTwilioSid(messageId, message.sid);
        }
        res.status(200).json({
            success: true,
            message: response.data.message.body,
            sid: message.sid,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Error al enviar la plantilla",
            error: error instanceof Error ? error.message : "An unknown error occurred",
        });
    }
});
// Ruta para obtener detalles de un mensaje específico por SID
router.get("/asadores/message/:sid", async (req, res) => {
    const { sid } = req.params;
    try {
        const message = await client.messages(sid).fetch();
        res.status(200).json({ success: true, message });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Error al obtener el mensaje",
            error: error instanceof Error ? error.message : "An unknown error occurred",
        });
    }
});
router.post("/asadores/webhook/status", async (req, res) => {
    try {
        const { MessageSid, MessageStatus, To, From, ErrorCode, ErrorMessage, Timestamp, } = req.body;
        console.log("📊 === TWILIO STATUS WEBHOOK ===");
        console.log("MessageSid:", MessageSid);
        console.log("Status:", MessageStatus);
        console.log("From:", From);
        console.log("To:", To);
        // Mapear estados de Twilio
        const statusMap = {
            queued: "queued",
            sent: "sent",
            delivered: "delivered",
            read: "read",
            failed: "failed",
            undelivered: "failed",
        };
        const mappedStatus = statusMap[MessageStatus] || MessageStatus;
        // Buscar el mensaje por twilio_sid
        const { data: existingMessage, error: fetchError } = await supabase
            .from("messages")
            .select("id, status")
            .eq("twilio_sid", MessageSid)
            .single();
        if (fetchError && fetchError.code !== "PGRST116") {
            console.error("Error fetching message:", fetchError);
            res.status(200).send("OK"); // Siempre responder 200 a Twilio
            return;
        }
        if (!existingMessage) {
            console.log("⚠️ Message not found for SID:", MessageSid);
            res.status(200).send("OK");
            return;
        }
        const previousStatus = existingMessage.status;
        // Definir jerarquía de estados
        const statusHierarchy = {
            queued: 1,
            sent: 2,
            delivered: 3,
            read: 4,
            failed: 5,
        };
        // Solo actualizar si es un estado "superior" o es un error
        const isErrorStatus = ["failed", "undelivered"].includes(MessageStatus);
        const shouldUpdate = isErrorStatus ||
            statusHierarchy[mappedStatus] > statusHierarchy[previousStatus];
        if (shouldUpdate) {
            // Preparar datos de actualización
            const updateData = {
                status: mappedStatus,
                error_code: ErrorCode || null,
                error_message: ErrorMessage || null,
            };
            // Agregar timestamps específicos
            switch (mappedStatus) {
                case "sent":
                    updateData.sent_at = new Date().toISOString();
                    break;
                case "delivered":
                    updateData.delivered_at = new Date().toISOString();
                    break;
                case "read":
                    updateData.read_at = new Date().toISOString();
                    break;
                case "failed":
                    updateData.failed_at = new Date().toISOString();
                    break;
            }
            // Actualizar el mensaje
            const { data: updatedMessage, error: updateError } = await supabase
                .from("messages")
                .update(updateData)
                .eq("id", existingMessage.id)
                .select()
                .single();
            if (updateError) {
                console.error("Error updating message:", updateError);
            }
            else {
                console.log(`✅ Updated message ${MessageSid}: ${previousStatus} → ${mappedStatus}`);
            }
        }
        // SIEMPRE guardar en el historial (para trazabilidad completa)
        const historyData = {
            message_id: existingMessage.id,
            twilio_sid: MessageSid,
            status: mappedStatus,
            previous_status: previousStatus,
            error_code: ErrorCode || null,
            error_message: ErrorMessage || null,
            raw_webhook: req.body, // Guardar todo el webhook
        };
        const { error: historyError } = await supabase
            .from("message_status_history")
            .insert(historyData);
        if (historyError) {
            console.error("Error saving history:", historyError);
        }
        console.log("================================");
        res.status(200).send("OK");
    }
    catch (error) {
        console.error("❌ Critical error in webhook:", error);
        // SIEMPRE responder 200 a Twilio para evitar reintentos
        res.status(200).send("OK");
    }
});
// Endpoint para obtener el historial completo de estados de un mensaje
router.get("/asadores/message-status/:sid", async (req, res) => {
    try {
        const { sid } = req.params;
        // Obtener el mensaje actual
        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select('*')
            .eq('twilio_sid', sid)
            .single();
        if (messageError) {
            return res.status(404).json({ error: "Message not found" });
        }
        // Obtener todo el historial de cambios
        const { data: history, error: historyError } = await supabase
            .from("message_status_history")
            .select("*")
            .eq("twilio_sid", sid)
            .order("created_at", { ascending: true });
        res.json({
            currentStatus: message.status,
            message: message,
            statusHistory: history || [],
            timeline: {
                sent: message.sent_at,
                delivered: message.delivered_at,
                read: message.read_at,
                failed: message.failed_at,
            },
        });
    }
    catch (error) {
        console.error("Error al obtener el estado:", error);
        let mensajeError = "Error desconocido";
        if (error instanceof Error) {
            mensajeError = error.message;
        }
        res.status(500).json({ error: mensajeError });
    }
});
// Ruta health check
router.get("/asadores/health", (req, res) => {
    res
        .status(200)
        .json({ success: true, message: "Health check - Asadores corriendo" });
});
export default router;
export { exportedFromNumber };
