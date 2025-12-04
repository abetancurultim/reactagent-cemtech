// Guardar hustorial de conversación en Supabase
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { TABLES } from "../config/tables";

dotenv.config();

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const CHAT_HISTORY_TABLE = "chat_history";
export const supabase = createClient(supabaseUrl, supabaseKey);


// Función para consultar si una persona está disponible para mandarle audios
export async function getAvailableForAudio(clientNumber: string, advisorId?: string) {
    try {
        // Verificar si el cliente ya tiene una conversación con este asesor específico
        let conversationQuery = supabase
            .from(CHAT_HISTORY_TABLE)
            .select('audio, advisor_id')
            .eq('client_number', clientNumber)
            .order("created_at", { ascending: false })
            .limit(1);

        // Si tenemos advisor_id, buscar conversación específica de ese asesor
        if (advisorId) {
            conversationQuery = conversationQuery.eq("advisor_id", advisorId);
        }

        const { data: existingConversation, error: fetchError } = await conversationQuery.maybeSingle();

        if (fetchError) {
            console.error(`Error fetching data in getAvailableForAudio: ${fetchError.message}`);
            console.error(`Client number: ${clientNumber}, Advisor ID: ${advisorId}`);
            return null;
        }    

        if (existingConversation) {
            console.log(`🔊 Found audio setting for ${clientNumber} with advisor ${advisorId || 'any'}: audio=${existingConversation.audio}`);
            return existingConversation.audio;
        }

        console.log(`🔇 No conversation found for ${clientNumber} with advisor ${advisorId || 'any'}`);
        return null;
    } catch (error) {
        console.error('Error in getAvailableForAudio:', error);
        console.error(`Client number: ${clientNumber}, Advisor ID: ${advisorId}`);
        return null;
    }
}