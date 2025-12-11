import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchVectors } from "../utils/retrievers.js";

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