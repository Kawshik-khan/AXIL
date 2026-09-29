import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { BrandService } from "@/domains/catalog";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const brands = await BrandService.listBrands(context);
    return apiSuccess({ brands });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const brand = await BrandService.createBrand(context, body);
    return apiSuccess({ brand }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
