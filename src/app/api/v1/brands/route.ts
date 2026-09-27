import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { BrandService } from "@/domains/catalog";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const brands = await BrandService.listBrands(context);
    return apiSuccess({ brands });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const brand = await BrandService.createBrand(context, body);
    return apiSuccess({ brand }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
