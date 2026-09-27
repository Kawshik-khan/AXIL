import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CategoryService } from "@/domains/catalog/category.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const categories = await CategoryService.listCategories(context);
    return apiSuccess({ categories });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const category = await CategoryService.createCategory(context, body);
    return apiSuccess({ category }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
