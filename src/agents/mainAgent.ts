import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import {
  searchCatalogTool,
  createQuoteTool,
  addLineItemTool,
  getQuoteDetailsTool,
  negotiatePriceTool,
  updateLineItemTool,
  deleteLineItemTool,
  generatePdfTool,
} from "../tools/tools.js";
import { MESSAGES } from "../config/constants.js";
import { exportedFromNumber } from "../routes/chatRoutes.js";

dotenv.config();

const memory = new MemorySaver();

const llm = new ChatOpenAI({
  model: "gpt-4.1",
  temperature: 0.4, // Ajusta la temperatura para controlar la creatividad de las respuestas
  topP: 1, // Esto ayuda a variar las respuestas y hacerlas más naturales
  apiKey: process.env.OPENAI_API_KEY,
  maxTokens: 1500,
});

const tools = [
  searchCatalogTool,
  createQuoteTool,
  addLineItemTool,
  getQuoteDetailsTool,
  negotiatePriceTool,
  updateLineItemTool,
  deleteLineItemTool,
  generatePdfTool,
];

const modifyMessages = async (messages: BaseMessage[]) => {
  const lastUserMessage = messages[messages.length - 1];
  const userText =
    typeof lastUserMessage.content === "string" ? lastUserMessage.content : "";

  // Combinar sistema + ejemplos estáticos
  const enhancedPrompt = `${MESSAGES.SYSTEM_PROMPT}

  ### COMMUNICATION STYLE:
  - **Be Concise:** Keep responses short and direct. Avoid long explanations unless requested.
  - **Direct Action:** Focus on the task. If calculating, show the numbers. If searching, say so briefly.

  ### CRITICAL INSTRUCTIONS FOR ESTIMATION & CATALOG SEARCH:
  1. **Language Fallback:** The database items are in English (e.g., "Concrete", "Rebar", "Wire Mesh"). If a user asks in Spanish (e.g., "Concreto"), you MUST search for the English equivalent ("Concrete").
  2. **Keep it Simple:** Search for single keywords (e.g., "Concrete") rather than long phrases.
  3. **Missing Items Strategy (IMPORTANT):** If you cannot find an item in the catalog (like "Gravel" or "Forms"), DO NOT STOP. 
     - You are an expert estimator. **Create a custom line item** using your knowledge of market rates.
     - Use the 'add_line_item' tool with the description and your estimated price.
     - Leave 'item_catalog_id' as null for these custom items.
     - **LINKING TO PARENT:** If adding an item to an existing job (e.g., adding Gravel to the Ramps section), you MUST provide the correct 'parent_line_id'. If you don't know it, use 'get_quote_details' first to find the ID of the parent section.
     - Inform the user: "Added [Item Name] based on market estimate as it wasn't in the catalog."
  4. **Goal:** Always produce a draft quote, even if some items are custom/estimated.
  5. **Scope of Work (PDF):** When creating a **Parent Job** (using 'add_line_item' with no parent_id), ALWAYS provide a 'scope_of_work' description. This text will appear in the final PDF under the title. Example: "Includes saw cutting, demolition, removal of debris, and pouring back 4000PSI concrete."
  6. **Finalizing:** When the user accepts the quote, use 'generate_pdf' to create the document and share the link.
  7. **Handling IDs (CRITICAL):** IDs are ALWAYS 36-character UUIDs (e.g., "550e8400-e29b..."). NEVER use a name (like "Curbs") as an ID. If you need to add an item to "Curbs", you MUST run 'get_quote_details' first, find the line item named "Curbs", copy its UUID, and use that as 'parent_line_id'.
  8. **Error Recovery:** If you get an error saying "invalid input syntax for type uuid", it means you sent a name instead of an ID. STOP. Call 'get_quote_details' to get the list of items and their IDs. Find the correct ID for the parent item. Then call 'add_line_item' again with the correct UUID.
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
