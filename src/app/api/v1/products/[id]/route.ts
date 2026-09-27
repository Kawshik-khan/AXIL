import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ProductService } from "@/domains/catalog/product.service";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const product = await ProductService.getProductById(context, params.id);
    return apiSuccess({ product });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const product = await ProductService.updateProduct(context, params.id, body);
    return apiSuccess({ product });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const success = await ProductService.archiveProduct(context, params.id);
    return apiSuccess({ success });
  } catch (err) {
    return apiError(err);
  }
}
