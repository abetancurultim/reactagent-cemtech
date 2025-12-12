// @ts-nocheck
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";
import { TABLES } from "../config/tables.js";
import { 
    getDynamicDemolitionPrice, 
    getDynamicLaborPrice, 
    shouldApplyDynamicPricing 
} from "../utils/pricing.js";

export const addLineItemTool = tool(
  async ({
    quote_id,
    parent_line_id,
    item_catalog_id,
    description,
    quantity,
    unit_price,
    scope_of_work,
  }: {
    quote_id: string;
    parent_line_id?: string;
    item_catalog_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    scope_of_work?: string;
  }) => {

    // --- DEBUG LOGS START ---
    console.log(`[DEBUG] addLineItemTool INVOCADA`);
    console.log(`[DEBUG] Params: quote_id=${quote_id}, item_catalog_id=${item_catalog_id}, parent=${parent_line_id}`);

    // Verificamos si TABLES está definido para descartar error de importación
    if (!TABLES || !TABLES.QUOTE_LINES || !TABLES.ITEMS_CATALOG) {
      console.error("[CRITICAL ERROR] TABLES constant is undefined or missing properties inside addLineItemTool!");
      console.error("Imported TABLES:", TABLES);
      return "Error interno: Configuración de tablas no cargada correctamente.";
    }
    // --- DEBUG LOGS END ---

    console.log(`[addLineItemTool] Input: quote_id=${quote_id}, parent_line_id=${parent_line_id}, description=${description}`);

    let finalParentId = parent_line_id;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (parent_line_id) {
      const isUuid = uuidRegex.test(parent_line_id);
      console.log(
        `[addLineItemTool] parent_line_id '${parent_line_id}' is UUID? ${isUuid}`
      );

      if (!isUuid) {
        console.log(
          `[addLineItemTool] Searching for parent by name: ${parent_line_id} in quote ${quote_id}`
        );
        
        const { data: lines, error: searchError } = await supabase
          .from("quote_lines")
          .select("id, description")
          .eq("quote_id", quote_id)
          .is("parent_line_id", null)
          .ilike("description", `%${parent_line_id}%`)
          .limit(1);

        if (searchError) {
          console.error(
            `[addLineItemTool] Search error: ${searchError.message}`
          );
        }

        if (lines && lines.length > 0) {
          console.log(
            `[addLineItemTool] Found parent: ${JSON.stringify(lines[0])}`
          );
          finalParentId = lines[0].id;
        } else {
          console.warn(
            `[addLineItemTool] No parent found for name '${parent_line_id}'`
          );
          
          return `Error: Could not find a Parent Job named '${parent_line_id}' in quote ${quote_id}. Please verify the name or use 'get_quote_details' to get the exact ID.`;
        }
      }
    }

    let finalCatalogId = item_catalog_id;
    if (!finalCatalogId || !uuidRegex.test(finalCatalogId)) {
      if (finalCatalogId) {
        console.warn(
          `[addLineItemTool] Invalid or Empty UUID for item_catalog_id: '${finalCatalogId}'. Treating as custom item (null).`
        );
      }
      finalCatalogId = null;
    } else {
      console.log(`[DEBUG] Verificando existencia de UUID: ${finalCatalogId}`);
      const { count, error: checkError } = await supabase
        .from("items_catalog")
        .select("id", { count: "exact", head: true })
        .eq("id", finalCatalogId);

      if (checkError || count === 0) {
        console.warn(
          `[addLineItemTool] UUID '${finalCatalogId}' has valid format but DOES NOT EXIST in catalog. Treating as custom item.`
        );
        finalCatalogId = null;
      } else {
        console.log(`[DEBUG] UUID '${finalCatalogId}' confirmado válido.`);
      }
    }

    console.log(
      `[addLineItemTool] Final Parent ID to use: ${finalParentId}, Final Catalog ID: ${finalCatalogId}`
    );

    let finalUnitPrice = unit_price;
    const pricingType = shouldApplyDynamicPricing(description);
    
    if (pricingType) {
      console.log(`[addLineItemTool] Detected dynamic pricing item: ${pricingType}`);
      if (pricingType === 'labor') {
        finalUnitPrice = getDynamicLaborPrice(quantity);
        console.log(`[addLineItemTool] Applied Dynamic Labor Price: $${finalUnitPrice} for ${quantity} sqft`);
      } else if (pricingType === 'demolition') {
        finalUnitPrice = getDynamicDemolitionPrice(quantity);
        console.log(`[addLineItemTool] Applied Dynamic Demolition Price: $${finalUnitPrice} for ${quantity} sqft`);
      }
    }

    const { data, error } = await supabase
      .from("quote_lines")
      .insert([
        {
          quote_id,
          parent_line_id: finalParentId || null,
          item_catalog_id: finalCatalogId || null,
          description,
          quantity,
          unit_price: finalUnitPrice,
          subtotal: quantity * finalUnitPrice,
          scope_of_work: scope_of_work || null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error(`[addLineItemTool] Insert error: ${error.message}`);
      return `Error adding line item: ${error.message}`;
    }

    console.log(`[addLineItemTool] Success. New Line ID: ${data.id}`);
    return `Line item added successfully. Line ID: ${data.id}`;
  },
  {
    name: "add_line_item",
    description: "Add a line item to a quote. Can be a Parent Job (no parent_line_id) or a Child Resource (requires parent_line_id).",
    schema: z.object({
      quote_id: z.string().describe("The ID of the active quote."),
      parent_line_id: z.string().nullable().optional().describe("The ID of the parent line item..."),
      item_catalog_id: z.string().nullable().optional().describe("The ID from the catalog if applicable."),
      description: z.string().describe("Description of the item or job."),
      quantity: z.coerce.number().describe("Quantity required."),
      unit_price: z.coerce.number().describe("Unit price for this specific quote line."),
      scope_of_work: z.string().nullable().optional().describe("Detailed scope of work..."),
    }),
  }
);