// Guardar hustorial de conversación en Supabase
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { TABLES } from "../config/tables.js";
import { getCampaignOrigin } from "./campaignDetector.js";

dotenv.config();

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const CHAT_HISTORY_TABLE = "chat_history";
const MESSAGES_TABLE = "messages";
export const supabase = createClient(supabaseUrl, supabaseKey);

// Función para guardar o actualizar el historial del chat
export async function saveChatHistory(
  clientNumber: string,
  newMessage: string,
  isClient: boolean,
  newMediaUrl: string,
  customSender?: string,
  origin?: string,
  fileName?: string,
  advisorId?: string // Nuevo parámetro para el ID del asesor
): Promise<number | null> {
  try {
    const firebaseMediaUrl = newMediaUrl ? newMediaUrl : "";

    // Buscar la conversación más reciente para este número y asesor
    let conversationQuery = supabase
      .from(CHAT_HISTORY_TABLE)
      .select("id, created_at, advisor_id")
      .eq("client_number", clientNumber)
      .order("created_at", { ascending: false })
      .limit(1);

    // Si tenemos advisor_id, incluirlo en la búsqueda
    if (advisorId) {
      conversationQuery = conversationQuery.eq("advisor_id", advisorId);
    }

    const { data: existingConversation, error: fetchError } = await conversationQuery.maybeSingle();

    if (fetchError) {
      throw new Error(`Error fetching data: ${fetchError.message}`);
    }

    let conversationId: number;

    if (existingConversation) {
      // Si ya existe una conversación, usar su ID
      conversationId = existingConversation.id;
      console.log(
        `Using existing conversation ${conversationId} for ${clientNumber}`
      );

      // Reiniciar flags de notificación si el mensaje es del cliente y la conversación no está cerrada
      if (isClient && existingConversation) {
        const { data: statusData, error: statusError } = await supabase
          .from(CHAT_HISTORY_TABLE)
          .select("chat_status, is_archived")
          .eq("id", conversationId)
          .maybeSingle();

        if (!statusError && statusData && statusData.chat_status !== "closed") {
          const { error: updateError } = await supabase
            .from(CHAT_HISTORY_TABLE)
            .update({
              notified_no_reply: false,
              notified_out_afternoon: false,
              notified_out_of_hours: false,
            })
            .eq("id", conversationId);

          if (updateError) {
            console.log(
              `Error reiniciando flags de notificación para la conversación ${conversationId}:`,
              updateError.message
            );
          } else {
            console.log(
              `Flags de notificación reiniciados para la conversación ${conversationId}`
            );
          }
        }

        // Desarchivar conversación si está archivada y llega un nuevo mensaje del cliente
        if (!statusError && statusData && statusData.is_archived === true) {
          const { error: unarchiveError } = await supabase
            .from(CHAT_HISTORY_TABLE)
            .update({
              is_archived: false,
            })
            .eq("id", conversationId);

          if (unarchiveError) {
            console.log(
              `Error desarchivando conversación ${conversationId}:`,
              unarchiveError.message
            );
          } else {
            console.log(
              `Conversación ${conversationId} desarchivada automáticamente por nuevo mensaje del cliente`
            );
          }
        }

        // Nueva funcionalidad: Si la conversación está cerrada y el cliente escribe después de 24 horas, abrir la conversación
        if (!statusError && statusData && statusData.chat_status === "closed") {
          try {
            // Obtener el último mensaje de la conversación para verificar el tiempo transcurrido
            const { data: lastMessage, error: lastMessageError } =
              await supabase
                .from(MESSAGES_TABLE)
                .select("created_at")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!lastMessageError && lastMessage) {
              const lastMessageTime = new Date(lastMessage.created_at);
              const currentTime = new Date();
              const timeDifferenceMinutes =
                (currentTime.getTime() - lastMessageTime.getTime()) /
                (1000 * 60);

              // Si han pasado 5 minutos o más desde el último mensaje
              if (timeDifferenceMinutes >= 5) {
                const { error: reopenError } = await supabase
                  .from(CHAT_HISTORY_TABLE)
                  .update({
                    chat_status: "open",
                    notified_no_reply: false,
                    notified_out_afternoon: false,
                    notified_out_of_hours: false,
                  })
                  .eq("id", conversationId);

                if (reopenError) {
                  console.log(
                    `Error reabriendo conversación cerrada ${conversationId}:`,
                    reopenError.message
                  );
                } else {
                  console.log(
                    `Conversación ${conversationId} reabierta automáticamente. Han pasado ${Math.floor(
                      timeDifferenceMinutes
                    )} minutos desde el último mensaje.`
                  );
                }
              } else {
                console.log(
                  `Conversación ${conversationId} está cerrada pero solo han pasado ${Math.floor(
                    timeDifferenceMinutes
                  )} minutos desde el último mensaje. Se requieren 5+ minutos para reabrir automáticamente.`
                );
              }
            }
          } catch (reopenError) {
            console.log(
              `Error verificando tiempo para reabrir conversación ${conversationId}:`,
              reopenError
            );
          }
        }
      }

      // Desarchivar conversación si está archivada y un agente envía un mensaje
      if (!isClient && existingConversation) {
        const { data: statusData, error: statusError } = await supabase
          .from(CHAT_HISTORY_TABLE)
          .select("is_archived")
          .eq("id", conversationId)
          .maybeSingle();

        if (!statusError && statusData && statusData.is_archived === true) {
          const { error: unarchiveError } = await supabase
            .from(CHAT_HISTORY_TABLE)
            .update({
              is_archived: false,
            })
            .eq("id", conversationId);

          if (unarchiveError) {
            console.log(
              `Error desarchivando conversación ${conversationId} al enviar mensaje del agente:`,
              unarchiveError.message
            );
          } else {
            console.log(
              `Conversación ${conversationId} desarchivada automáticamente al enviar mensaje del agente`
            );
          }
        }
      }
    } else {
      // Verificar si el cliente existe en la tabla users para enriquecer los datos
      let clientName = null;
      let clientEmail = null;
      let nit = null;
      let company = null;
      let category = null;

      try {
        const { data: existingUser, error: userFetchError } = await supabase
          .from("users")
          .select("name, email, nit, company, category")
          .eq("phone", clientNumber)
          .maybeSingle();

        // Si encontramos el usuario, capturamos sus datos
        if (!userFetchError && existingUser) {
          clientName = existingUser.name;
          clientEmail = existingUser.email;
          nit = existingUser.nit;
          company = existingUser.company;
          category = existingUser.category;
        }
      } catch (userError) {
        // Si hay error en la consulta de usuario, solo lo logueamos pero continuamos
        console.log(
          "Info: Could not fetch user data, proceeding with conversation creation"
        );
      }

      // Intentar crear una nueva conversación con manejo de conflictos
      try {
        const { data: newConversation, error: insertError } = await supabase
          .from(CHAT_HISTORY_TABLE)
          .insert([
            {
              client_number: clientNumber,
              client_name: clientName,
              email: clientEmail,
              nit: nit,
              company: company,
              category: category,
              advisor_id: advisorId, // Agregar advisor_id aquí
              // -----------------------------
              //chat_on: origin === "campaign" ? false : true, // FALSE si campaña = IA, TRUE si orgánico = human
              // -----------------------------
              // Temporal: campañas también inician en HUMANO (IA apagada)
              // Antes: campaign => false (IA), organic => true (humano)
              chat_on: false,
              origin: origin || "organic", // Guardar el origen de la conversación
            },
          ])
          .select("id")
          .single();

        if (insertError) {
          // Si hay error de duplicado, intentar buscar la conversación que se creó para este asesor específico
          console.log(
            "Conflict detected, searching for existing conversation..."
          );
          
          let conflictQuery = supabase
            .from(CHAT_HISTORY_TABLE)
            .select("id")
            .eq("client_number", clientNumber)
            .order("created_at", { ascending: false })
            .limit(1);

          // Si tenemos advisor_id, incluirlo en la búsqueda de conflicto para asegurar consistencia
          if (advisorId) {
            conflictQuery = conflictQuery.eq("advisor_id", advisorId);
          }

          const { data: conflictConversation, error: conflictFetchError } = await conflictQuery.single();

          if (conflictFetchError) {
            throw new Error(
              `Error handling conflict: ${conflictFetchError.message}`
            );
          }

          conversationId = conflictConversation.id;
          console.log(
            `Using conversation created by concurrent request: ${conversationId} for advisor ${advisorId || 'any'}`
          );
        } else {
          conversationId = newConversation.id;
          console.log(
            `Created new conversation ${conversationId} for ${clientNumber} with advisor ${advisorId || 'any'}`
          );
        }
      } catch (createError) {
        throw new Error(`Error creating conversation: ${createError}`);
      }
    }

    // Insertar el mensaje en la tabla messages
    const { data: messageData, error: messageError } = await supabase
      .from(MESSAGES_TABLE)
      .insert([
        {
          conversation_id: conversationId,
          advisor_id: advisorId, // Agregar advisor_id aquí
          sender:
            customSender || (isClient ? "client_message" : "agent_message"),
          message: newMessage,
          url: firebaseMediaUrl,
          file_name: fileName || null,
          created_at: new Date().toISOString(),
        },
      ])
      .select("id");

    if (messageError) {
      throw new Error(`Error inserting message: ${messageError.message}`);
    }

    const messageId = messageData?.[0]?.id;
    console.log(
      `Message saved successfully to conversation ${conversationId}, message ID: ${messageId}`
    );
    return messageId;
  } catch (error) {
    console.error("Error in saveChatHistory:", error);
    return null;
  }
}

// Función para guardar mensajes de plantillas
export async function saveTemplateChatHistory(
  clientNumber: string,
  newMessage: string,
  isClient: boolean,
  newMediaUrl: string,
  user: string,
  advisorId?: string // Agregar advisor_id como parámetro
): Promise<number | null> {
  try {
    const firebaseMediaUrl = newMediaUrl ? newMediaUrl : "";

    // Buscar la conversación más reciente para este número y asesor específico
    let conversationQuery = supabase
      .from(CHAT_HISTORY_TABLE)
      .select("id, created_at, advisor_id")
      .eq("client_number", clientNumber)
      .order("created_at", { ascending: false })
      .limit(1);

    // Si tenemos advisor_id, incluirlo en la búsqueda para plantillas específicas del asesor
    if (advisorId) {
      conversationQuery = conversationQuery.eq("advisor_id", advisorId);
    }

    const { data: existingConversation, error: fetchError } = await conversationQuery.maybeSingle();

    if (fetchError) {
      throw new Error(`Error fetching data: ${fetchError.message}`);
    }

    let conversationId: number;

    if (existingConversation) {
      // Si ya existe una conversación para este asesor específico, usar su ID
      conversationId = existingConversation.id;
      console.log(
        `Using existing conversation ${conversationId} for template to ${clientNumber} with advisor ${advisorId || 'any'}`
      );

      // Desarchivar conversación si está archivada cuando se envía una plantilla
      const { data: statusData, error: statusError } = await supabase
        .from(CHAT_HISTORY_TABLE)
        .select("is_archived")
        .eq("id", conversationId)
        .maybeSingle();

      if (!statusError && statusData && statusData.is_archived === true) {
        const { error: unarchiveError } = await supabase
          .from(CHAT_HISTORY_TABLE)
          .update({
            is_archived: false,
          })
          .eq("id", conversationId);

        if (unarchiveError) {
          console.log(
            `Error desarchivando conversación ${conversationId} al enviar plantilla:`,
            unarchiveError.message
          );
        } else {
          console.log(
            `Conversación ${conversationId} desarchivada automáticamente al enviar plantilla`
          );
        }
      }
    } else {
      // Verificar si el cliente existe en la tabla users para enriquecer los datos
      let clientName = null;
      let clientEmail = null;
      let nit = null;
      let company = null;
      let category = null;

      try {
        const { data: existingUser, error: userFetchError } = await supabase
          .from("users")
          .select("name, email, nit, company, category")
          .eq("phone", clientNumber)
          .maybeSingle();

        // Si encontramos el usuario, capturamos sus datos
        if (!userFetchError && existingUser) {
          clientName = existingUser.name;
          clientEmail = existingUser.email;
          nit = existingUser.nit;
          company = existingUser.company;
          category = existingUser.category;
        }
      } catch (userError) {
        // Si hay error en la consulta de usuario, solo lo logueamos pero continuamos
        console.log(
          "Info: Could not fetch user data, proceeding with conversation creation"
        );
      }

      // Intentar crear una nueva conversación con manejo de conflictos
      try {
        const { data: newConversation, error: insertError } = await supabase
          .from(CHAT_HISTORY_TABLE)
          .insert([
            {
              client_number: clientNumber,
              client_name: clientName,
              email: clientEmail,
              nit: nit,
              company: company,
              category: category,
              advisor_id: advisorId, // Agregar advisor_id para plantillas también
              chat_on: false,
            },
          ])
          .select("id")
          .single();

        if (insertError) {
          // Si hay error de duplicado, intentar buscar la conversación que se creó para este asesor
          console.log(
            "Template conflict detected, searching for existing conversation..."
          );
          
          let conflictQuery = supabase
            .from(CHAT_HISTORY_TABLE)
            .select("id")
            .eq("client_number", clientNumber)
            .order("created_at", { ascending: false })
            .limit(1);

          // Si tenemos advisor_id, incluirlo en la búsqueda de conflicto
          if (advisorId) {
            conflictQuery = conflictQuery.eq("advisor_id", advisorId);
          }

          const { data: conflictConversation, error: conflictFetchError } = await conflictQuery.single();

          if (conflictFetchError) {
            throw new Error(
              `Error handling template conflict: ${conflictFetchError.message}`
            );
          }

          conversationId = conflictConversation.id;
          console.log(
            `Using conversation created by concurrent template request: ${conversationId}`
          );
        } else {
          conversationId = newConversation.id;
          console.log(
            `Created new conversation ${conversationId} for template to ${clientNumber} with advisor ${advisorId || 'any'}`
          );
        }
      } catch (createError) {
        throw new Error(
          `Error creating conversation for template: ${createError}`
        );
      }
    }

    // Insertar el mensaje en la tabla messages con el usuario específico
    const { data: messageData, error: messageError } = await supabase
      .from(MESSAGES_TABLE)
      .insert([
        {
          conversation_id: conversationId,
          advisor_id: advisorId, // Agregar advisor_id también a los mensajes de plantilla
          sender: user, // Usar el usuario específico para plantillas
          message: newMessage,
          url: firebaseMediaUrl,
          created_at: new Date().toISOString(),
        },
      ])
      .select("id");

    if (messageError) {
      throw new Error(
        `Error inserting template message: ${messageError.message}`
      );
    }

    const messageId = messageData?.[0]?.id;
    console.log(
      `Template message saved successfully to conversation ${conversationId}, message ID: ${messageId}`
    );
    return messageId;
  } catch (error) {
    console.error("Error in saveTemplateChatHistory:", error);
    return null;
  }
}

// Función para actualizar el SID de Twilio en un mensaje existente
export async function updateMessageTwilioSid(
  messageId: number,
  twilioSid: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(MESSAGES_TABLE)
      .update({ twilio_sid: twilioSid })
      .eq("id", messageId);

    if (error) {
      throw new Error(
        `Error updating message with Twilio SID: ${error.message}`
      );
    }

    console.log(`Message ${messageId} updated with Twilio SID: ${twilioSid}`);
    return true;
  } catch (error) {
    console.error("Error in updateMessageTwilioSid:", error);
    return false;
  }
}
