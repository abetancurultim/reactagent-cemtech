import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";
import { 
    getDynamicDemolitionPrice, 
    getDynamicLaborPrice, 
    shouldApplyDynamicPricing 
} from "../utils/pricing.js";

export const updateLineItemTool = tool(
  async ({
    line_id,
    quantity,
    description,
    unit_price,
    scope_of_work,
  }: {
    line_id: string;
    quantity?: number;
    description?: string;
    unit_price?: number;
    scope_of_work?: string;
  }) => {
    console.log(`[updateLineItemTool] Input: line_id=${line_id}, qty=${quantity}, desc=${description}, price=${unit_price}`);

    const { data: currentItem, error: fetchError } = await supabase
      .from("quote_lines")
      .select("*")
      .eq("id", line_id)
      .single();

    if (fetchError) {
      console.error(`[updateLineItemTool] Error fetching item: ${fetchError.message}`);
      return `Error fetching item: ${fetchError.message}`;
    }

    const updates: any = {};
    if (description !== undefined) updates.description = description;
    if (scope_of_work !== undefined) updates.scope_of_work = scope_of_work;

    let newQuantity = currentItem.quantity;
    let newPrice = currentItem.unit_price;
    let newDescription = currentItem.description;

    if (quantity !== undefined) {
      updates.quantity = quantity;
      newQuantity = quantity;
    }
    if (description !== undefined) {
        newDescription = description;
    }
    if (unit_price !== undefined) {
      updates.unit_price = unit_price;
      newPrice = unit_price;
    }

    // --- DYNAMIC PRICING LOGIC START (UPDATE) ---
    const pricingType = shouldApplyDynamicPricing(newDescription);
    if (pricingType && (quantity !== undefined || description !== undefined)) {
         // If it's a dynamic price item, we FORCE the price based on the quantity (sqft)
         // ignoring the user-provided unit_price if it conflicts with the rule, 
         // OR we could just overwrite it. Let's overwrite to enforce the rule.
         let calculatedPrice = newPrice;
         if (pricingType === 'labor') {
            calculatedPrice = getDynamicLaborPrice(newQuantity);
         } else if (pricingType === 'demolition') {
            calculatedPrice = getDynamicDemolitionPrice(newQuantity);
         }

         if (calculatedPrice !== newPrice) {
             console.log(`[updateLineItemTool] Enforcing dynamic price: Was ${newPrice}, Now ${calculatedPrice} for ${newQuantity} sqft`);
             newPrice = calculatedPrice;
             updates.unit_price = newPrice;
         }
    }
    // --- DYNAMIC PRICING LOGIC END ---

    if (quantity !== undefined || unit_price !== undefined || updates.unit_price !== undefined) {
      updates.subtotal = newQuantity * newPrice;
    }

    const { data, error } = await supabase
      .from("quote_lines")
      .update(updates)
      .eq("id", line_id)
      .select()
      .single();

    if (error) {
      console.error(`[updateLineItemTool] Error updating: ${error.message}`);
      return `Error updating line item: ${error.message}`;
    }

    console.log(`[updateLineItemTool] Success. New subtotal: ${data.subtotal}`);
    return `Line item updated successfully.`;
  },
  {
    name: "update_line_item",
    description: "Update details of an existing line item (quantity, description, price, scope). Use this to fix mistakes or adjust quantities instead of adding new items.",
    schema: z.object({
      line_id: z.string().describe("The ID of the line item to update."),
      quantity: z.coerce.number().optional().describe("New quantity."),
      description: z.string().optional().describe("New description."),
      unit_price: z.coerce.number().optional().describe("New unit price."),
      scope_of_work: z.string().optional().describe("New scope of work text."),
    }),
  }
);