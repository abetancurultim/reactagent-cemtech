import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage, } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { retrieverTool, conversationExamplesTool, searchProductsTool, } from "../tools/tools.js";
import { MESSAGES, CONVERSATION_EXAMPLES } from "../config/constants.js";
import { exportedFromNumber } from "../routes/chatRoutes.js";
dotenv.config();
const memory = new MemorySaver();
const llm = new ChatOpenAI({
    model: "gpt-4.1",
    temperature: 0.4, // Ajusta la temperatura para controlar la creatividad de las respuestas
    topP: 1, // Esto ayuda a variar las respuestas y hacerlas más naturales
    apiKey: process.env.OPENAI_API_KEY,
    maxTokens: 220,
});
const tools = [retrieverTool, conversationExamplesTool, searchProductsTool];
const modifyMessages = async (messages) => {
    const lastUserMessage = messages[messages.length - 1];
    const userText = typeof lastUserMessage.content === "string" ? lastUserMessage.content : "";
    // Combinar sistema + ejemplos estáticos
    const enhancedPrompt = `${MESSAGES.SYSTEM_PROMPT_PROVICIONAL}

    ${CONVERSATION_EXAMPLES}

    INSTRUCCIÓN: Imita el estilo de estos ejemplos reales de conversación. Sé breve, directo y natural, como en los ejemplos. No uses frases genéricas como "¿En qué le puedo ayudar hoy?".
    `;
    return [
        new SystemMessage(enhancedPrompt),
        new HumanMessage(`Este es el número de teléfono: ${exportedFromNumber}`),
        ...messages,
    ];
};
export const appWithMemory = createReactAgent({
    llm,
    tools,
    messageModifier: modifyMessages,
    checkpointSaver: memory,
});
