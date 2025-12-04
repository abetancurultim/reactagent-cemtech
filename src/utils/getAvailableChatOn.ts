// Guardar hustorial de conversación en Supabase
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { TABLES } from "../config/tables";

dotenv.config();

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const CHAT_HISTORY_TABLE = "chat_history";
export const supabase = createClient(supabaseUrl, supabaseKey);

// Función para consultar si el chat está activado para atención por IA
export async function getAvailableChatOn(clientNumber: string, advisorId?: string) {
  try {
    // Verificar si el cliente ya tiene una conversación con este asesor específico
    let conversationQuery = supabase
      .from(CHAT_HISTORY_TABLE)
      .select("chat_on, origin, advisor_id")
      .eq("client_number", clientNumber)
      .order("created_at", { ascending: false })
      .limit(1);

    // Si tenemos advisor_id, buscar conversación específica de ese asesor
    if (advisorId) {
      conversationQuery = conversationQuery.eq("advisor_id", advisorId);
    }

    const { data: existingConversation, error: fetchError } = await conversationQuery.maybeSingle();

    if (fetchError) {
      console.error(
        `Error fetching data in getAvailableChatOn: ${fetchError.message}`
      );
      console.error(`Client number: ${clientNumber}, Advisor ID: ${advisorId}`);
      return null;
    }

    if (existingConversation) {
      console.log(
        `🔍 Found conversation for ${clientNumber} with advisor ${advisorId || 'any'}: chat_on=${existingConversation.chat_on}, origin=${existingConversation.origin}`
      );

      // Respetar SIEMPRE el valor de chat_on de la conversación específica del asesor
      return existingConversation.chat_on;
    }

    console.log(`📭 No conversation found for ${clientNumber} with advisor ${advisorId || 'any'}`);
    return null;
  } catch (error) {
    console.error("Error in getAvailableChatOn:", error);
    console.error(`Client number: ${clientNumber}, Advisor ID: ${advisorId}`);
    return null;
  }
}
