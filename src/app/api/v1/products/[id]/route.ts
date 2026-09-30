import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ProductService } from "@/domains/catalog/product.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const product = await ProductService.getProductById(context, params.id);
    return apiSuccess({ product });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const product = await ProductService.updateProduct(context, params.id, body);
    return apiSuccess({ product });
  } catch (err) {
    return apiError(err);
  }
}

async function handleDELETE(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const success = await ProductService.archiveProduct(context, params.id);
    return apiSuccess({ success });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
export const DELETE = withStore("DELETE", handleDELETE);
