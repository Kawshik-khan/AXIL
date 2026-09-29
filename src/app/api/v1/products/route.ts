import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ProductService } from "@/domains/catalog/product.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const category_id = searchParams.get("category_id") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const result = await ProductService.listProducts(context, {
      category_id,
      status,
      search,
      limit,
      offset,
    });

    return apiSuccess(result.products, { total: result.total });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const product = await ProductService.createProduct(context, body);
    return apiSuccess({ product }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
