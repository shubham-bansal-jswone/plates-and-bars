import type { OffProduct } from '../src/barcode/lookup';

/** Valid codes: EAN-13, UPC-A and an 8-digit UPC-E that expands to 042100005264. */
export const EAN13 = '5000112637922';
export const UPC_A = '042100005264';
export const UPC_E = '04252614';

/** A contract `OffProduct` (GET /foods/barcode/{code}); `over` replaces top-level fields. */
export function product(over: Partial<OffProduct> = {}): OffProduct {
  return {
    code: EAN13,
    name: 'Peanut bar',
    brands: 'Acme',
    quantity: '50 g',
    serving_size: '1 bar (50 g)',
    serving_quantity: 50,
    nutrition_data_per: '100g',
    nutriments: { 'energy-kcal_100g': 400, proteins_100g: 20, carbohydrates_100g: 40, fat_100g: 16, fiber_100g: 6 },
    completeness: 0.9,
    states_tags: ['en:nutrition-facts-completed'],
    data_quality_errors_tags: [],
    countries_tags: ['en:india'],
    last_modified_at: '2026-01-01T00:00:00Z',
    source: { code: 'open_food_facts', name: 'Open Food Facts', licence: 'ODbL 1.0 / DbCL 1.0', url: `https://world.openfoodfacts.org/product/${EAN13}`, reference: EAN13 },
    ...over,
  };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
