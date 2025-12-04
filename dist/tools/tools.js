// @ts-nocheck
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchConversations, searchVectors } from "../utils/retrievers.js";
import { searchProducts } from "../utils/functions.js";
export const retrieverTool = tool(async ({ query }) => {
    const results = await searchVectors(query);
    return results;
}, {
    name: "retriever",
    description: "Eres una herramienta de consulta de información sobre Asadores El Barril. Tu tarea es buscar y extraer solo la información relevante de la base de datos, respondiendo a las consultas de los clientes. Siempre entrega el resultado bien formateado para que sea facil de leer. Usa esta herramienta para responder preguntas específicas sobre preguntas frecuentes, politicas de devolucion e informacion general de la empresa, productos a la venta.",
    schema: z.object({
        query: z.string(),
    }),
});
// Tool para buscar ejemplos de conversaciones
export const conversationExamplesTool = tool(async ({ query }) => {
    const results = await searchConversations(query);
    return results;
}, {
    name: "conversation_examples",
    description: "Busca ejemplos de conversaciones reales entre asesores y clientes para usar como referencia. Utiliza esta herramienta cuando necesites ejemplos de cómo los asesores humanos responden a situaciones similares, o cuando quieras imitar el estilo conversacional natural de un asesor de Asadores El Barril.",
    schema: z.object({
        query: z
            .string()
            .describe("La situación o consulta para la que necesitas ejemplos de conversación"),
    }),
});
// Tool para búsqueda flexible de productos
export const searchProductsTool = tool(async ({ line, size, packageType, }) => {
    const filters = { line, size, packageType };
    const results = await searchProducts(filters);
    return results;
}, {
    name: "search_products",
    description: "Herramienta de búsqueda flexible de productos de Asadores El Barril. Permite buscar barriles por línea (Premium/Lite), tamaño (Bebé/Mini/Pequeño/Mediano/Grande), y tipo de paquete (Básico/Combo). Los filtros son opcionales y se pueden combinar. Úsala cuando el cliente busque productos específicos o cuando necesites recomendar barriles basándote en sus necesidades (cantidad de personas, tipo de uso, presupuesto, etc.).",
    schema: z.object({
        line: z
            .string()
            .optional()
            .describe("Línea del producto: 'Premium' para acero 304 con 10 años de garantía, 'Lite' para acero 430 con 3 años de garantía (más económica)"),
        size: z
            .string()
            .optional()
            .describe("Tamaño del barril: 'Bebé' (3lb, 4-6 personas), 'Mini' (13lb, 8-10 personas), 'Pequeño' (30lb, 12-18 personas), 'Mediano' (45lb, 30-35 personas), 'Grande' (60-100lb, 60-70 personas)"),
        packageType: z
            .string()
            .optional()
            .describe("Tipo de paquete: 'Básico' (solo el barril) o 'Combo' (incluye accesorios adicionales)"),
    }),
});
