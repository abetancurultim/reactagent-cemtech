import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";
import { TABLES } from "../config/tables.js";
// 1.5 Search Quotes Tool
export const searchQuotesTool = tool(async ({ query }) => {
    const { data, error } = await supabase
        .from(TABLES.QUOTES)
        .select("id, project_name, total_amount, status, created_at, pdf_url, client_name")
        .ilike("client_name", `%${query}%`)
        .order("created_at", { ascending: false });
    if (error) {
        return `Error searching quotes: ${error.message}`;
    }
    if (!data || data.length === 0) {
        return "No quotes found matching that client name.";
    }
    return JSON.stringify(data);
}, {
    name: "search_quotes",
    description: "Search for existing quotes by client name. Returns a list of quotes with their IDs, project names, status, and PDF URLs. Use this when a user wants to find or modify a previous quote.",
    schema: z.object({
        query: z
            .string()
            .describe("The client name to search for."),
    }),
});
