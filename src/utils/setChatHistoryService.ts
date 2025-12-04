// Guardar hustorial de conversación en Supabase
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { exportedFromNumber } from '../routes/chatRoutes.js';
import { TABLES } from "../config/tables";

dotenv.config();

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const CHAT_HISTORY_TABLE = "chat_history";
export const supabase = createClient(supabaseUrl, supabaseKey);

// Función para para actualizar el service en la base de datos en la tabla chat_history.
export async function setChatHistoryService(service: string): Promise<void> {
    try {
        // Verificar que tenemos un número de teléfono válido
        if (!exportedFromNumber) {
            console.error('No phone number available to update chat history service');
            return;
        }

        console.log(`Attempting to update chat history service for: ${exportedFromNumber}`);

        // Verificar si el cliente ya tiene una conversación
        const { data: existingConversation, error: fetchError } = await supabase
            .from(CHAT_HISTORY_TABLE)
            .select('id')
            .eq('client_number', exportedFromNumber)
            .maybeSingle();

        if (fetchError) {
            throw new Error(`Error fetching data: ${fetchError.message}`);
        }

        if (existingConversation) {
            // Si el cliente ya tiene una conversación, actualizar el servicio
            const { error: updateError } = await supabase
                .from(CHAT_HISTORY_TABLE)
                .update({ service: service })
                .eq('id', existingConversation.id);

            if (updateError) {
                throw new Error(`Error updating data: ${updateError.message}`);
            } else {
                console.log('Service updated successfully');
            }
        } else {
            console.log(`No existing conversation found for ${exportedFromNumber}, skipping service update`);
        }
        
    } catch (error) {
        console.error('Error in setChatHistoryService:', error);
    }
}