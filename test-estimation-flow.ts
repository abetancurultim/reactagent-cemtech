import { searchCatalogTool, createQuoteTool, addLineItemTool, getQuoteDetailsTool, negotiatePriceTool } from "./src/tools/tools.js";

async function runTest() {
  console.log("--- Starting Estimation Flow Test ---");

  // 1. Search Catalog
  console.log("\n1. Testing Search Catalog...");
  try {
    const catalogResult = await searchCatalogTool.invoke({ query: "Concrete" });
    console.log("Catalog Search Result:", catalogResult);
  } catch (e) {
    console.log("Skipping catalog search (might be empty DB):", e);
  }

  // 2. Create Quote
  console.log("\n2. Testing Create Quote...");
  let quoteId = "";
  try {
    const quoteResult = await createQuoteTool.invoke({ client_number: "+15551234567", project_name: "Test Driveway" });
    console.log("Create Quote Result:", quoteResult);
    
    const quoteIdMatch = quoteResult.match(/Quote ID: ([a-f0-9-]+)/);
    if (quoteIdMatch) {
      quoteId = quoteIdMatch[1];
    }
  } catch (e) {
    console.error("Error creating quote:", e);
    return;
  }

  if (!quoteId) {
    console.error("Failed to get Quote ID, stopping test.");
    return;
  }

  // 3. Add Parent Item (Job)
  console.log("\n3. Testing Add Parent Item...");
  let parentId = "";
  try {
    const parentItemResult = await addLineItemTool.invoke({
      quote_id: quoteId,
      description: "Driveway Construction",
      quantity: 1,
      unit_price: 0 // Parent usually 0
    });
    console.log("Parent Item Result:", parentItemResult);

    const parentIdMatch = parentItemResult.match(/Line ID: ([a-f0-9-]+)/);
    if (parentIdMatch) {
        parentId = parentIdMatch[1];
    }
  } catch (e) {
    console.error("Error adding parent item:", e);
  }

  // 4. Add Child Item (Resource)
  let childId = "";
  if (parentId) {
    console.log("\n4. Testing Add Child Item...");
    try {
      const childItemResult = await addLineItemTool.invoke({
        quote_id: quoteId,
        parent_line_id: parentId,
        description: "Concrete 3000PSI",
        quantity: 10,
        unit_price: 150
      });
      console.log("Child Item Result:", childItemResult);

      const childIdMatch = childItemResult.match(/Line ID: ([a-f0-9-]+)/);
      if (childIdMatch) {
        childId = childIdMatch[1];
      }
    } catch (e) {
      console.error("Error adding child item:", e);
    }
  }

  // 5. Get Quote Details
  console.log("\n5. Testing Get Quote Details...");
  try {
    const detailsResult = await getQuoteDetailsTool.invoke({ quote_id: quoteId });
    console.log("Quote Details:", detailsResult);
  } catch (e) {
    console.error("Error getting details:", e);
  }

  // 6. Negotiate Price
  if (childId) {
      console.log("\n6. Testing Negotiate Price...");
      try {
        const negotiateResult = await negotiatePriceTool.invoke({
            line_id: childId,
            new_unit_price: 140
        });
        console.log("Negotiate Result:", negotiateResult);
        
        // Verify change
        const detailsAfter = await getQuoteDetailsTool.invoke({ quote_id: quoteId });
        console.log("Quote Details After Negotiation:", detailsAfter);
      } catch (e) {
        console.error("Error negotiating:", e);
      }
  }

  console.log("\n--- Test Complete ---");
}

runTest().catch(console.error);
