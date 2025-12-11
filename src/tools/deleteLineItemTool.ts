import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";

// 7. Delete Line Item Tool
export const deleteLineItemTool = tool(
  async ({ line_id }: { line_id: string }) => {
    console.log(`[deleteLineItemTool] Input: line_id=${line_id}`);

    // Check if it has children first (optional, but good for logging)
    const { count, error: countError } = await supabase
      .from("quote_lines")
      .select("*", { count: "exact", head: true })
      .eq("parent_line_id", line_id);

    if (count && count > 0) {
      console.log(`[deleteLineItemTool] Item has ${count} children. They will be deleted via cascade or manual deletion.`);
      // If your DB doesn't have ON DELETE CASCADE, you'd need to delete children here.
      // Assuming ON DELETE CASCADE is set up or we delete children first.
      // Let's try deleting the parent directly.
    }

    const { error } = await supabase
      .from("quote_lines")
      .delete()
      .eq("id", line_id);

    if (error) {
      console.error(`[deleteLineItemTool] Error deleting: ${error.message}`);
      return `Error deleting line item: ${error.message}`;
    }

    console.log(`[deleteLineItemTool] Success.`);
    return `Line item ${line_id} deleted successfully.`;
  },
  {
    name: "delete_line_item",
    description: "Delete a line item from the quote. If it's a parent item, this might delete its children depending on DB settings.",
    schema: z.object({
      line_id: z.string().describe("The ID of the line item to delete."),
    }),
  }
);