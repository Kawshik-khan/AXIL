import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CategoryService } from "@/domains/catalog/category.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const categories = await CategoryService.listCategories(context);
    return apiSuccess({ categories });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const category = await CategoryService.createCategory(context, body);
    return apiSuccess({ category }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
