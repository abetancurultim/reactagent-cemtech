import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

// Twilio configuration
const MessagingResponse = twilio.twiml.MessagingResponse;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
export const supabase = createClient(supabaseUrl, supabaseKey);

// Definimos la interfaz para los filtros que la IA nos enviará
// --- INTERFACES Y TIPOS ---

interface ProductFilters {
  line?: string;
  size?: string;
  packageType?: string;
}

// Interfaz para el objeto de resultado, mejora la seguridad de tipos
interface SearchResult {
  success: boolean;
  message: string;
  count: number;
  products: any[]; // 'any' por ahora, pero se puede definir un tipo 'Product'
  searchCriteria: ProductFilters;
  suggestion?: string;
  error?: string;
}

// --- FUNCIÓN PRINCIPAL (EXPORTADA) ---

/**
 * Función de búsqueda flexible de productos.
 * Procesa los filtros, llama a la función de lógica interna y devuelve el resultado como un string JSON.
 * @param filters - Objeto con filtros opcionales: line, size, packageType
 * @returns Un string JSON con los resultados de la búsqueda.
 */
export async function searchProducts(filters: ProductFilters): Promise<string> {
  const result = await _searchProductsLogic(filters);
  return JSON.stringify(result);
}

// --- LÓGICA INTERNA DE BÚSQUEDA ---

/**
 * Contiene el núcleo de la lógica de búsqueda. Retorna un objeto tipado.
 * Esta función podría ser reutilizada en otras partes de la aplicación, por eso se separa.
 * @param filters - Objeto con filtros opcionales.
 * @returns Un objeto `SearchResult` con los resultados.
 * @private
 */
async function _searchProductsLogic(filters: ProductFilters): Promise<SearchResult> {
  console.log("Buscando productos con los filtros:", filters);

  try {
    let query = supabase.from("products_view").select("*");

    // Construcción dinámica de la consulta
    if (filters.line) {
      query = query.ilike("line", `%${filters.line}%`);
    }
    if (filters.size) {
      query = query.ilike("size", `%${filters.size}%`);
    }
    if (filters.packageType) {
      const type = normalizeText(filters.packageType).includes("combo")
        ? "En Combo"
        : "Básico";
      query = query.eq("package_type", type);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error al buscar productos:", error);
      return {
        success: false,
        message: "Error en la base de datos al buscar productos.",
        error: error.message,
        count: 0,
        products: [],
        searchCriteria: filters,
      };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        message: "No se encontraron productos que coincidan con los criterios especificados. Puedes probar con términos más amplios.",
        count: 0,
        products: [],
        searchCriteria: filters,
        suggestion: "Intenta buscar por: 'Premium' o 'Lite' para líneas, 'Bebé', 'Mini', 'Pequeño', 'Mediano', 'Grande' para tamaños, o 'Básico', 'Combo' para tipos de paquete.",
      };
    }

    let resultMessage = "";
    if (data.length === 1) {
      resultMessage = "¡Perfecto! Se encontró exactamente el producto que buscas.";
    } else {
      resultMessage = `Se encontraron ${data.length} productos que coinciden con tu búsqueda. ¿Cuál te interesa más?`;
    }

    return {
      success: true,
      message: resultMessage,
      count: data.length,
      products: data,
      searchCriteria: filters,
    };

  } catch (err) {
    const error = err as Error;
    console.error("Error inesperado en searchProducts:", error);
    return {
      success: false,
      message: "Ocurrió un error inesperado en la función de búsqueda. Por favor, intenta nuevamente.",
      error: error.message,
      count: 0,
      products: [],
      searchCriteria: filters,
    };
  }
}

// --- FUNCIÓN UTILITARIA ---

/**
 * Limpia y normaliza un string: lo convierte a minúsculas y le quita las tildes.
 * Útil para hacer las búsquedas más flexibles y resistentes a errores de tipeo.
 * @param text - El texto a normalizar.
 * @returns El texto normalizado.
 */
function normalizeText(text: string = ''): string {
  return text
    .toLowerCase()
    .normalize("NFD") // Descompone los caracteres acentuados (ej: 'é' -> 'e' + '´')
    .replace(/[\u0300-\u036f]/g, ""); // Elimina los diacríticos (las tildes)
}
