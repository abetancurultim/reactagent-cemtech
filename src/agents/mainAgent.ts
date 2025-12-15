import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { searchCatalogTool } from "../tools/searchCatalogTool.js";
import { searchQuotesTool } from "../tools/searchQuotesTool.js";
import { createQuoteTool } from "../tools/createQuoteTool.js";
import { addLineItemTool } from "../tools/addLineItemTool.js";
import { getQuoteDetailsTool } from "../tools/getQuoteDetailsTool.js";
import { negotiatePriceTool } from "../tools/negotiatePriceTool.js";
import { updateLineItemTool } from "../tools/updateLineItemTool.js";
import { deleteLineItemTool } from "../tools/deleteLineItemTool.js";
import { generatePdfTool } from "../tools/generatePdfTool.js";
import { analyzeBlueprintTool } from "../tools/analyzeBlueprintTool.js";
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
  searchQuotesTool,
  createQuoteTool,
  addLineItemTool,
  getQuoteDetailsTool,
  negotiatePriceTool,
  updateLineItemTool,
  deleteLineItemTool,
  generatePdfTool,
  analyzeBlueprintTool,
];

const modifyMessages = async (messages: BaseMessage[]) => {
  const lastUserMessage = messages[messages.length - 1];
  const userText =
    typeof lastUserMessage.content === "string" ? lastUserMessage.content : "";

  // Combinar sistema + ejemplos estáticos
  const enhancedPrompt = `${MESSAGES.SYSTEM_PROMPT}

  ### LANGUAGE INSTRUCTIONS:
  - **DEFAULT TO ENGLISH:** The company is in Atlanta. Unless the user explicitly speaks Spanish, your output MUST be in English.

  ### NEW CAPABILITY: BLUEPRINT ANALYSIS (analyze_blueprint)
  1. **Trigger:** Use this when the user asks to "analyze the plan", "read the PDF", or "give a quote from this file".
  2. **Process:**
     - Ask for the file path if not provided (assume 'public/quotes/filename.pdf' structure if they just give a name).
     - Call 'analyze_blueprint'. This will take a moment.
  3. **Handling Results:**
     - The tool returns a JSON list of items.
     - **DO NOT** simply dump the JSON text to the user.
     - **ACTION REQUIRED:** You must iterate through the items found and call 'add_line_item' for each one to build the actual quote in the database.
     - If an item is "Concrete Slab" with "400 sqft", call add_line_item(description="Concrete Slab", quantity=400, unit="sqft").
     - If the tool says "ESTIMATE" in notes, tell the user: "I extracted these quantities, but some are estimates based on the plan."

  ### COMMUNICATION STYLE:
  - **Be Concise:** Keep responses short and direct. Avoid long explanations unless requested.
  - **Direct Action:** Focus on the task. If calculating, show the numbers. If searching, say so briefly.

  ### CRITICAL INSTRUCTIONS FOR ESTIMATION & CATALOG SEARCH:
  1. **Language Fallback:** The database items are in English (e.g., "Concrete", "Rebar", "Wire Mesh"). If a user asks in Spanish (e.g., "Concreto"), you MUST search for the English equivalent ("Concrete").
  2. **Keep it Simple:** Search for single keywords (e.g., "Concrete") rather than long phrases.
  3. **Missing Items Strategy (IMPORTANT):** If you cannot find an item in the catalog (like "Gravel" or "Forms"), DO NOT STOP. 
     - You are an expert estimator. **Create a custom line item** using your knowledge of market rates.
     - Use the 'add_line_item' tool with the description and your estimated price.
     - **CRITICAL:** Leave 'item_catalog_id' EMPTY (undefined/null) for custom items. Do NOT put the name of the item there.
     - **LINKING TO PARENT:** If adding an item to an existing job (e.g., adding Gravel to the Ramps section), you MUST provide the correct 'parent_line_id'. If you don't know it, use 'get_quote_details' first to find the ID of the parent section.
     - Inform the user: "Added [Item Name] based on market estimate as it wasn't in the catalog."
  4. **Goal:** Always produce a draft quote, even if some items are custom/estimated.
  5. **Scope of Work (PDF):** When creating a **Parent Job** (using 'add_line_item' with no parent_id), ALWAYS provide a 'scope_of_work' description. This text will appear in the final PDF under the title. Example: "Includes saw cutting, demolition, removal of debris, and pouring back 4000PSI concrete."
  6. **Finalizing:** When the user accepts the quote, use 'generate_pdf' to create the document. **CRITICAL:** You MUST output the raw URL of the PDF in your response (e.g., "https://..."). Do NOT use markdown links like [Download](url). WhatsApp does not support them. Just paste the full URL.
  7. **Handling IDs (CRITICAL):** IDs are ALWAYS 36-character UUIDs (e.g., "550e8400-e29b..."). NEVER use a name (like "Curbs") as an ID. If you need to add an item to "Curbs", you MUST run 'get_quote_details' first, find the line item named "Curbs", copy its UUID, and use that as 'parent_line_id'.
  8. **Error Recovery:** If you get an error saying "invalid input syntax for type uuid", it means you sent a name instead of an ID. STOP. Call 'get_quote_details' to get the list of items and their IDs. Find the correct ID for the parent item. Then call 'add_line_item' again with the correct UUID.
  9. **Searching Quotes:** If a user asks to see their previous quotes or modify an existing one, use 'search_quotes' with their name. Present the list of found quotes (Project Name, Date, Total) and ask which one they want to work on.
  10. **PRICING RULES (STRICT):**
      - **Labor & Demolition:** Prices are dynamic based on project size (sqft).
        - < 1,999 sqft: $9.00/sqft
        - 2,000 - 7,000 sqft: $6.00/sqft
        - > 7,000 sqft: $4.50/sqft
      - **Minimum Project Cost:** The minimum cost for any project is **$2,800**.
      - **Agent Behavior:** You do not need to manually calculate these prices. The system will automatically apply the correct unit price for Labor/Demolition and add a "Minimum Project Fee Adjustment" if the total is below $2,800. You can explain this to the user if they ask why the price changed or why there is an extra fee.
  `;

  return [
    new SystemMessage(enhancedPrompt),
    new HumanMessage(`User phone number: ${exportedFromNumber}`),
    ...messages,
  ];
};

export const appWithMemory = createReactAgent({
  llm,
  tools,
  messageModifier: modifyMessages,
  checkpointSaver: memory,
});
