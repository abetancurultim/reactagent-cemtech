import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";
// 1. Search Catalog Tool
export const searchCatalogTool = tool(async ({ query, category }) => {
    let queryBuilder = supabase
        .from("items_catalog")
        .select("*")
        .ilike("name", `%${query}%`);
    if (category) {
        queryBuilder = queryBuilder.eq("category", category);
    }
    const { data, error } = await queryBuilder;
    if (error) {
        return `Error searching catalog: ${error.message}`;
    }
    if (!data || data.length === 0) {
        return "No items found in the catalog matching your query.";
    }
    return JSON.stringify(data);
}, {
    name: "search_catalog",
    description: "Search for items in the master catalog (items_catalog) by name or category. Use this to find base prices and item IDs.",
    schema: z.object({
        query: z
            .string()
            .describe("The name or partial name of the item to search for (e.g., 'Concrete', 'Labor')."),
        category: z
            .string()
            .optional()
            .describe("Optional category filter (e.g., 'Material', 'Labor', 'Equipment')."),
    }),
});
