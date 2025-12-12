import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "../utils/functions.js";
import { TABLES } from "../config/tables.js";

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