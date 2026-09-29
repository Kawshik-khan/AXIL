import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ProductService } from "@/domains/catalog/product.service";
import { CsvParser } from "@/lib/csv-parser";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const contentType = request.headers.get("content-type") || "";

    let rows: Record<string, any>[] = [];
    let options: Record<string, any> = {};

    if (contentType.includes("text/csv") || contentType.includes("application/csv")) {
      const text = await request.text();
      const parsed = CsvParser.parse(text);
      if (parsed.rows.length === 0) {
        throw new BadRequestError("The uploaded CSV file is empty or missing data rows.");
      }
      rows = parsed.rows;
    } else {
      // JSON payload
      const body = await request.json();
      if (Array.isArray(body)) {
        rows = body;
      } else if (body && Array.isArray(body.products)) {
        rows = body.products;
        options = body.options || {};
      } else {
        throw new BadRequestError("Request payload must contain a 'products' array or be a CSV file.");
      }
    }

    if (rows.length === 0) {
      throw new BadRequestError("No product rows provided for import.");
    }

    const result = await ProductService.bulkImportProducts(context, rows, options);

    return apiSuccess(result, {
      batch_id: result.batch_id,
      total_rows: result.total_rows,
      imported: result.imported_count,
      updated: result.updated_count,
      failed: result.failed_count,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
