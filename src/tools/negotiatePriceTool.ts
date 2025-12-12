import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";

export const negotiatePriceTool = tool(
  async ({ line_id, new_unit_price }: { line_id: string; new_unit_price: number }) => {
    console.log(`[negotiatePriceTool] Input: line_id=${line_id}, new_unit_price=${new_unit_price}`);
    
    const { data: line, error: fetchError } = await supabase
      .from("quote_lines")
      .select("quantity")
      .eq("id", line_id)
      .single();

    if (fetchError) {
      console.error(`[negotiatePriceTool] Error fetching line: ${fetchError.message}`);
      return `Error fetching line item: ${fetchError.message}`;
    }

    const newSubtotal = line.quantity * new_unit_price;

    const { data, error } = await supabase
      .from("quote_lines")
      .update({ unit_price: new_unit_price, subtotal: newSubtotal })
      .eq("id", line_id)
      .select()
      .single();

    if (error) {
      console.error(`[negotiatePriceTool] Error updating: ${error.message}`);
      return `Error updating price: ${error.message}`;
    }

    console.log(`[negotiatePriceTool] Success.`);
    return `Price updated successfully for line ${line_id}. New unit price: ${new_unit_price}, New subtotal: ${newSubtotal}`;
  },
  {
    name: "negotiate_price",
    description: "Update the unit price of a specific line item in a quote. This allows for negotiation without changing the master catalog.",
    schema: z.object({
      line_id: z.string().describe("The ID of the quote line item to update."),
      new_unit_price: z.coerce.number().describe("The new unit price to apply."),
    }),
  }
);