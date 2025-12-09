// @ts-nocheck
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchConversations, searchVectors } from "../utils/retrievers.js";
import { searchProducts, supabase } from "../utils/functions.js";
import { TABLES } from "../config/tables.js";
import { generateQuotePDF } from "../utils/pdfGenerator.js";

export const retrieverTool = tool(
  async ({ query }: { query: string }) => {
    const results = await searchVectors(query);
    return results;
  },
  {
    name: "retriever",
    description:
      "Eres una herramienta de consulta de información sobre Asadores El Barril. Tu tarea es buscar y extraer solo la información relevante de la base de datos, respondiendo a las consultas de los clientes. Siempre entrega el resultado bien formateado para que sea facil de leer. Usa esta herramienta para responder preguntas específicas sobre preguntas frecuentes, politicas de devolucion e informacion general de la empresa, productos a la venta.",
    schema: z.object({
      query: z.string(),
    }),
  }
);

// 1. Search Catalog Tool
export const searchCatalogTool = tool(
  async ({ query, category }: { query: string; category?: string }) => {
    let queryBuilder = supabase
      .from(TABLES.ITEMS_CATALOG)
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
  },
  {
    name: "search_catalog",
    description:
      "Search for items in the master catalog (items_catalog) by name or category. Use this to find base prices and item IDs.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "The name or partial name of the item to search for (e.g., 'Concrete', 'Labor')."
        ),
      category: z
        .string()
        .optional()
        .describe(
          "Optional category filter (e.g., 'Material', 'Labor', 'Equipment')."
        ),
    }),
  }
);

// 1.5 Search Quotes Tool
export const searchQuotesTool = tool(
  async ({ query }: { query: string }) => {
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
  },
  {
    name: "search_quotes",
    description:
      "Search for existing quotes by client name. Returns a list of quotes with their IDs, project names, status, and PDF URLs. Use this when a user wants to find or modify a previous quote.",
    schema: z.object({
      query: z
        .string()
        .describe("The client name to search for."),
    }),
  }
);

// 2. Create Quote Tool
export const createQuoteTool = tool(
  async ({
    client_number,
    project_name,
    client_name,
    client_email,
  }: {
    client_number: string;
    project_name: string;
    client_name: string;
    client_email: string;
  }) => {
    const { data, error } = await supabase
      .from(TABLES.QUOTES)
      .insert([
        {
          client_number,
          project_name,
          client_name,
          client_email,
          status: "draft",
        },
      ])
      .select()
      .single();

    if (error) {
      return `Error creating quote: ${error.message}`;
    }

    return `Quote created successfully. Quote ID: ${data.id}`;
  },
  {
    name: "create_quote",
    description:
      "Create a new empty quote for a client. Returns the Quote ID. Requires client name and email.",
    schema: z.object({
      client_number: z
        .string()
        .describe("The client's phone number or identifier."),
      project_name: z
        .string()
        .describe("A short name for the project (e.g., 'Smith Driveway')."),
      client_name: z.string().describe("The full name of the client."),
      client_email: z.string().describe("The email address of the client."),
    }),
  }
);

// 3. Add Line Item Tool (Hierarchical)
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
    // If it's a child item (resource), parent_line_id is required.
    // If it's a parent item (job), parent_line_id is null.

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
        // Try to find the parent by description
        // CRITICAL: Only search for top-level items (parent_line_id is null) to avoid matching children.
        const { data: lines, error: searchError } = await supabase
          .from(TABLES.QUOTE_LINES)
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
          // Fallback: Try searching without the NULL check just in case, but warn.
          // Or better, return a clear error asking the user to be more specific or use get_quote_details.
          return `Error: Could not find a Parent Job named '${parent_line_id}' in quote ${quote_id}. Please verify the name or use 'get_quote_details' to get the exact ID.`;
        }
      }
    }

    // Validate item_catalog_id to prevent UUID errors
    let finalCatalogId = item_catalog_id;
    // If it's an empty string, undefined, or invalid UUID, force it to null.
    if (!finalCatalogId || !uuidRegex.test(finalCatalogId)) {
      if (finalCatalogId) {
        console.warn(
          `[addLineItemTool] Invalid or Empty UUID for item_catalog_id: '${finalCatalogId}'. Treating as custom item (null).`
        );
      }
      finalCatalogId = null;
    }

    console.log(
      `[addLineItemTool] Final Parent ID to use: ${finalParentId}, Final Catalog ID: ${finalCatalogId}`
    );

    const { data, error } = await supabase
      .from(TABLES.QUOTE_LINES)
      .insert([
        {
          quote_id,
          parent_line_id: finalParentId || null,
          item_catalog_id: finalCatalogId || null,
          description,
          quantity,
          unit_price,
          subtotal: quantity * unit_price,
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
      parent_line_id: z.string().optional().describe("The ID of the parent line item if this is a resource/child. Leave empty for main jobs."),
      item_catalog_id: z.string().optional().describe("The ID from the catalog if applicable."),
      description: z.string().describe("Description of the item or job."),
      quantity: z.coerce.number().describe("Quantity required."),
      unit_price: z.coerce.number().describe("Unit price for this specific quote line."),
      scope_of_work: z.string().optional().describe("Detailed scope of work for Parent Jobs (e.g., 'Includes demo, pouring...'). Not needed for child items."),
    }),
  }
);

// 4. Get Quote Details Tool
export const getQuoteDetailsTool = tool(
  async ({ quote_id }: { quote_id: string }) => {
    console.log(`[getQuoteDetailsTool] Input: quote_id=${quote_id}`);
    // Fetch quote info
    const { data: quote, error: quoteError } = await supabase
      .from(TABLES.QUOTES)
      .select("*")
      .eq("id", quote_id)
      .single();

    if (quoteError) {
      console.error(`[getQuoteDetailsTool] Error fetching quote: ${quoteError.message}`);
      return `Error fetching quote: ${quoteError.message}`;
    }

    // Fetch lines
    const { data: lines, error: linesError } = await supabase
      .from(TABLES.QUOTE_LINES)
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

    // Organize hierarchically
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
          calculated_total: childrenTotal > 0 ? childrenTotal : parent.subtotal // If parent has children, its cost is usually sum of children unless it's a flat fee
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

// 5. Negotiate Price Tool
export const negotiatePriceTool = tool(
  async ({ line_id, new_unit_price }: { line_id: string; new_unit_price: number }) => {
    console.log(`[negotiatePriceTool] Input: line_id=${line_id}, new_unit_price=${new_unit_price}`);
    // First get the current quantity to update subtotal
    const { data: line, error: fetchError } = await supabase
      .from(TABLES.QUOTE_LINES)
      .select("quantity")
      .eq("id", line_id)
      .single();

    if (fetchError) {
      console.error(`[negotiatePriceTool] Error fetching line: ${fetchError.message}`);
      return `Error fetching line item: ${fetchError.message}`;
    }

    const newSubtotal = line.quantity * new_unit_price;

    const { data, error } = await supabase
      .from(TABLES.QUOTE_LINES)
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

// 6. Update Line Item Tool (General Update)
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

    // 1. Get current item to calculate new subtotal if needed
    const { data: currentItem, error: fetchError } = await supabase
      .from(TABLES.QUOTE_LINES)
      .select("*")
      .eq("id", line_id)
      .single();

    if (fetchError) {
      console.error(`[updateLineItemTool] Error fetching item: ${fetchError.message}`);
      return `Error fetching item: ${fetchError.message}`;
    }

    // 2. Prepare updates
    const updates: any = {};
    if (description !== undefined) updates.description = description;
    if (scope_of_work !== undefined) updates.scope_of_work = scope_of_work;

    let newQuantity = currentItem.quantity;
    let newPrice = currentItem.unit_price;

    if (quantity !== undefined) {
      updates.quantity = quantity;
      newQuantity = quantity;
    }
    if (unit_price !== undefined) {
      updates.unit_price = unit_price;
      newPrice = unit_price;
    }

    // Recalculate subtotal if quantity or price changed
    if (quantity !== undefined || unit_price !== undefined) {
      updates.subtotal = newQuantity * newPrice;
    }

    // 3. Perform update
    const { data, error } = await supabase
      .from(TABLES.QUOTE_LINES)
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

// 7. Delete Line Item Tool
export const deleteLineItemTool = tool(
  async ({ line_id }: { line_id: string }) => {
    console.log(`[deleteLineItemTool] Input: line_id=${line_id}`);

    // Check if it has children first (optional, but good for logging)
    const { count, error: countError } = await supabase
      .from(TABLES.QUOTE_LINES)
      .select("*", { count: "exact", head: true })
      .eq("parent_line_id", line_id);

    if (count && count > 0) {
      console.log(`[deleteLineItemTool] Item has ${count} children. They will be deleted via cascade or manual deletion.`);
      // If your DB doesn't have ON DELETE CASCADE, you'd need to delete children here.
      // Assuming ON DELETE CASCADE is set up or we delete children first.
      // Let's try deleting the parent directly.
    }

    const { error } = await supabase
      .from(TABLES.QUOTE_LINES)
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

// 8. Generate PDF Tool
export const generatePdfTool = tool(
  async ({ quote_id }: { quote_id: string }) => {
    try {
      const pdfUrl = await generateQuotePDF(quote_id);
      return `PDF generated successfully! You can download it here: ${pdfUrl}`;
    } catch (error: any) {
      return `Error generating PDF: ${error.message}`;
    }
  },
  {
    name: "generate_pdf",
    description: "Generate a formal PDF quote for the client. Use this when the client is satisfied with the draft and asks for the final document.",
    schema: z.object({
      quote_id: z.string().describe("The ID of the quote to generate."),
    }),
  }
);
