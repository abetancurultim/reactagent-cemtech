// Guardar hustorial de conversación en Supabase
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { exportedFromNumber } from '../routes/chatRoutes.js';
dotenv.config();
// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const CHAT_HISTORY_TABLE = "chat_history";
export const supabase = createClient(supabaseUrl, supabaseKey);
// Función para Actualizar si el cliente quiere o no audios
export async function setAvailableForAudio(isAvailableForAudio) {
    try {
        // Verificar que tenemos un número de teléfono válido
        if (!exportedFromNumber) {
            console.error('No phone number available to update audio preference');
            return "error";
        }
        // Verificar si el cliente ya tiene una conversación
        const { data: existingConversation, error: fetchError } = await supabase
            .from(CHAT_HISTORY_TABLE)
            .select('id')
            .eq('client_number', exportedFromNumber)
            .maybeSingle();
        if (fetchError) {
            console.error(`Error fetching data: ${fetchError.message}`);
            return "error";
        }
        if (existingConversation) {
            // Si el cliente ya tiene una conversación, actualizar la preferencia de audio
            const { error: updateError } = await supabase
                .from(CHAT_HISTORY_TABLE)
                .update({ audio: isAvailableForAudio })
                .eq('id', existingConversation.id);
            if (updateError) {
                console.error(`Error updating data: ${updateError.message}`);
                return "error";
            }
            else {
                console.log('Audio preference updated successfully');
                return "deacuerdo";
            }
        }
        else {
            console.log(`No existing conversation found for ${exportedFromNumber}, skipping audio preference update`);
            return "error";
        }
    }
    catch (error) {
        console.error('Error in setAvailableForAudio:', error);
        return "error";
    }
}
