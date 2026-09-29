import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { GoogleSheetHelper } from "@/lib/google-sheet";
import { CsvParser } from "@/lib/csv-parser";
import { BadRequestError } from "@/lib/errors";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PRODUCTS_READ);

    const body = await request.json().catch(() => ({}));
    const spreadsheetUrl = body.spreadsheet_url || body.url || body.spreadsheet_id;

    if (!spreadsheetUrl || typeof spreadsheetUrl !== "string") {
      throw new BadRequestError("Google Spreadsheet link or ID is required.");
    }

    const sheetName = body.sheet_name || body.sheet || undefined;

    // Check if tenant has configured a Google Sheets connector with a saved API key
    let apiKey: string | undefined = body.api_key;
    if (!apiKey) {
      try {
        const configuredConnector = db.findConnectorByProvider(context.tenant.id, "prov_google_sheets");
        if (configuredConnector?.credentials_encrypted) {
          const { decryptCredential } = await import("@/lib/security");
          const creds = decryptCredential<Record<string, any>>(configuredConnector.credentials_encrypted);
          if (creds && typeof creds.api_key === "string") {
            apiKey = creds.api_key;
          }
        }
      } catch {
        // Fallback: non-blocking
      }
    }

    const spreadsheetId = GoogleSheetHelper.extractSpreadsheetId(spreadsheetUrl);
    const csvContent = await GoogleSheetHelper.fetchGoogleSheetCsv(spreadsheetUrl, sheetName, apiKey);

    const parsed = CsvParser.parse(csvContent);
    if (parsed.rows.length === 0) {
      throw new BadRequestError("No data rows found in the specified Google Sheet.");
    }

    return apiSuccess({
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName || "Default",
      headers: parsed.headers,
      rows: parsed.rows,
      total_rows: parsed.rows.length,
      csv_preview: csvContent.slice(0, 1000),
    });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
