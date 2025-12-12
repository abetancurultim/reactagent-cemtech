import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";
import { TABLES } from "../config/tables.js";

// 4. Get Quote Details Tool
export const getQuoteDetailsTool = tool(
  async ({ quote_id }: { quote_id: string }) => {
    console.log(`[getQuoteDetailsTool] Input: quote_id=${quote_id}`);

    const { data: quote, error: quoteError } = await supabase
      .from(TABLES.QUOTES)
      .select("*")
      .eq("id", quote_id)
      .single();

    if (quoteError) {
      console.error(`[getQuoteDetailsTool] Error fetching quote: ${quoteError.message}`);
      return `Error fetching quote: ${quoteError.message}`;
    }

    const { data: lines, error: linesError } = await supabase
      .from("quote_lines")
      .select(`
        *,
        items_catalog (
          name,
          unit
        )
      `)
      .eq("quote_id", quote_id)
      .order("created_at", { ascending: true }); // Assuming created_at exists or use id

    if (linesError) {
      console.error(`[getQuoteDetailsTool] Error fetching lines: ${linesError.message}`);
      return `Error fetching quote lines: ${linesError.message}`;
    }

    const parents = lines.filter((l: any) => !l.parent_line_id);
    const children = lines.filter((l: any) => l.parent_line_id);

    const structuredQuote = {
      ...quote,
      items: parents.map((parent: any) => {
        const myChildren = children.filter((child: any) => child.parent_line_id === parent.id);
        const childrenTotal = myChildren.reduce((sum: number, child: any) => sum + child.subtotal, 0);
        return {
          ...parent,
          children: myChildren,
          calculated_total: childrenTotal > 0 ? childrenTotal : parent.subtotal 
        };
      })
    };

    console.log(`[getQuoteDetailsTool] Success. Returning ${parents.length} parent items.`);
    parents.forEach((p: any) => console.log(`[getQuoteDetailsTool] Found Parent: ${p.description} (${p.id})`));
    return JSON.stringify(structuredQuote, null, 2);
  },
  {
    name: "get_quote_details",
    description: "Get the full details of a quote, including all line items organized hierarchically.",
    schema: z.object({
      quote_id: z.string().describe("The ID of the quote to retrieve."),
    }),
  }
);