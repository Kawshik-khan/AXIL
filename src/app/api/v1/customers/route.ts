import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CustomerService } from "@/domains/customers/customer.service";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow } from "@/lib/validation";
import { CUSTOMER_SEGMENTS, CUSTOMER_SORTS } from "@/lib/customer-segments";

const ListFilters = z
  .object({ segment: z.enum(CUSTOMER_SEGMENTS).optional(), sort: z.enum(CUSTOMER_SORTS).optional() })
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") || undefined;
    const cursor = searchParams.get("cursor") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;
    const { segment, sort } = parseOrThrow(ListFilters, {
      segment: searchParams.get("segment") || undefined,
      sort: searchParams.get("sort") || undefined,
    });

    const result = await CustomerService.listCustomers(context, {
      search,
      limit,
      offset,
      cursor,
      segment,
      sort,
    });

    return apiSuccess(result.customers, {
      total: result.total,
      segment_counts: result.segment_counts ?? null,
      next_cursor: result.next_cursor ?? null,
      has_more: result.has_more ?? false,
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const customer = await CustomerService.createCustomer(context, body);
    return apiSuccess({ customer }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
