
export const MINIMUM_PROJECT_COST = 2800;

/**
 * Calculates the labor price per sqft based on the project size.
 * Rules:
 * - < 1,999 sqft: $9.00
 * - 2,000 - 7,000 sqft: $6.00
 * - > 7,000 sqft: $4.50
 * 
 * @param sqft The total square footage of the project/item.
 * @returns The price per sqft.
 */
export function getDynamicLaborPrice(sqft: number): number {
  if (sqft < 2000) {
    return 9.00;
  } else if (sqft <= 7000) {
    return 6.00;
  } else {
    return 4.50;
  }
}

/**
 * Calculates the demolition price per sqft based on the project size.
 * Rules (Same as Labor for now based on requirements):
 * - < 1,999 sqft: $9.00
 * - 2,000 - 7,000 sqft: $6.00
 * - > 7,000 sqft: $4.50
 * 
 * Note: The user requirement said "De la misma manera el demolition", 
 * implying the same tiers apply.
 * 
 * @param sqft The total square footage of the project/item.
 * @returns The price per sqft.
 */
export function getDynamicDemolitionPrice(sqft: number): number {
    // Reusing the same logic as labor as requested ("De la misma manera el demolition")
    // If the base prices were different but tiers same, we would adjust here.
    // Assuming the tiers and prices are identical based on "De la misma manera".
    // However, looking at tables.sql, Demolition base was 6 and Pour Back was 12.
    // The user prompt says:
    // "Si el proyecto es menos de 1999 sqft el precio del labor es de 9 dolares... De la misma manera el demolition"
    // This implies Demolition ALSO follows the 9/6/4.5 structure.
    
    if (sqft < 2000) {
        return 9.00;
    } else if (sqft <= 7000) {
        return 6.00;
    } else {
        return 4.50;
    }
}

/**
 * Helper to determine if an item description triggers dynamic pricing.
 */
export function shouldApplyDynamicPricing(description: string): 'labor' | 'demolition' | null {
    const lowerDesc = description.toLowerCase();
    
    // Check for Demolition first
    if (lowerDesc.includes('demolition') || lowerDesc.includes('demo ')) {
        return 'demolition';
    }
    
    // Check for Labor (Pour back, concrete labor, etc)
    // We need to be careful not to catch "Material" if description is vague, 
    // but usually "Labor" is explicit or implied by context. 
    // Based on tables.sql: 'Pour Back Labor', 'Demolition Labor'.
    if (lowerDesc.includes('labor') || lowerDesc.includes('pour back') || lowerDesc.includes('finish')) {
        return 'labor';
    }

    return null;
}
