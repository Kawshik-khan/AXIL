/**
 * CommerceOS — Google Sheets Integration Utilities
 * Extracts IDs, formats CSV export endpoints, and fetches public/authenticated sheet rows.
 */

import { BadRequestError } from "@/lib/errors";

export class GoogleSheetHelper {
  /**
   * Extract spreadsheet ID from various Google Docs URL formats or raw ID string.
   *
   * Supported formats:
   * - https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
   * - https://docs.google.com/spreadsheets/d/e/2PACX-1vQ.../pubhtml
   * - docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
   * - 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
   */
  public static extractSpreadsheetId(urlOrId: string): string {
    if (!urlOrId || typeof urlOrId !== "string") {
      throw new BadRequestError("Google Spreadsheet URL or ID is required.");
    }

    const trimmed = urlOrId.trim();

    // 1. Match /spreadsheets/d/e/([a-zA-Z0-9-_]+) for published sheets first
    const pubMatch = trimmed.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/i);
    if (pubMatch && pubMatch[1]) {
      return pubMatch[1];
    }

    // 2. Match standard /spreadsheets/d/([a-zA-Z0-9-_]+)
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
    if (match && match[1] && match[1] !== "e") {
      return match[1];
    }

    // If it's a raw ID (typically 25-60 alphanumeric characters, dashes, underscores)
    if (/^[a-zA-Z0-9-_]{20,80}$/.test(trimmed)) {
      return trimmed;
    }

    throw new BadRequestError(
      "Invalid Google Spreadsheet link or ID. Please provide a link in the format: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"
    );
  }

  /**
   * Extract sheet tab name or gid from URL if present
   */
  public static extractGid(url: string): string | undefined {
    if (!url || typeof url !== "string") return undefined;
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/i);
    return gidMatch ? gidMatch[1] : undefined;
  }

  /**
   * Build Google Sheets gviz/tq CSV export URL
   */
  public static buildGoogleSheetCsvUrl(spreadsheetId: string, sheetName?: string, gid?: string): string {
    const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
    if (sheetName && sheetName.trim().length > 0) {
      return `${base}&sheet=${encodeURIComponent(sheetName.trim())}`;
    }
    if (gid) {
      return `${base}&gid=${gid}`;
    }
    return base;
  }

  /**
   * Fetch raw CSV content from a Google Sheet via server-side HTTP request
   */
  public static async fetchGoogleSheetCsv(
    urlOrId: string,
    sheetName?: string,
    apiKey?: string
  ): Promise<string> {
    const spreadsheetId = this.extractSpreadsheetId(urlOrId);
    const gid = typeof urlOrId === "string" ? this.extractGid(urlOrId) : undefined;
    const targetSheet = sheetName?.trim() || undefined;

    // 1. If API Key is provided, use Google Sheets API v4
    if (apiKey && apiKey.trim().length > 0) {
      const range = targetSheet ? `${encodeURIComponent(targetSheet)}!A1:ZZ` : "A1:ZZ";
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${apiKey.trim()}`;

      const res = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new BadRequestError(
          `Google Sheets API Error (${res.status}): ${
            errorJson.error?.message || "Failed to fetch spreadsheet data with provided API key."
          }`
        );
      }

      const json = await res.json();
      const rows: string[][] = json.values || [];
      if (rows.length === 0) {
        throw new BadRequestError("The requested sheet has no rows or values.");
      }

      // Convert 2D array to CSV format
      return rows
        .map((row) =>
          row
            .map((cell) => {
              const str = String(cell ?? "");
              if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(",")
        )
        .join("\r\n");
    }

    // 2. Default: fetch via Google Visualization CSV export endpoint (works for any sheet with link sharing)
    const exportUrl = this.buildGoogleSheetCsvUrl(spreadsheetId, targetSheet, gid);

    let res: Response;
    try {
      res = await fetch(exportUrl, {
        headers: {
          Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": "CommerceOS-Catalog-Sync/1.0",
        },
      });
    } catch (networkErr: any) {
      throw new BadRequestError(`Network connection to Google Sheets failed: ${networkErr.message}`);
    }

    if (!res.ok) {
      if (res.status === 404) {
        throw new BadRequestError("Google Spreadsheet not found. Please verify your spreadsheet URL or ID.");
      }
      if (res.status === 401 || res.status === 403) {
        throw new BadRequestError(
          "Could not access Google Sheet. Please ensure the sheet's General Access is set to 'Anyone with the link can view' (or provide a Google Cloud API Key in the Connector Hub)."
        );
      }
      throw new BadRequestError(`Google Sheets returned HTTP error status ${res.status}.`);
    }

    const csvContent = await res.text();

    // Check if Google returned an HTML login page instead of CSV
    if (
      csvContent.includes("<!DOCTYPE html>") ||
      csvContent.includes("<html") ||
      csvContent.includes("accounts.google.com") ||
      csvContent.includes("ServiceLogin")
    ) {
      throw new BadRequestError(
        "Access denied by Google. Please change the sheet sharing settings to 'Anyone with the link can view'."
      );
    }

    // Check if Google returned a visualization query error response
    if (csvContent.includes("google.visualization.Query.setResponse") || csvContent.includes('"status":"error"')) {
      const sheetNotFoundMatch = csvContent.match(/Sheet not found:\s*([^"']+)/i);
      if (sheetNotFoundMatch) {
        throw new BadRequestError(
          `Sheet tab '${sheetNotFoundMatch[1]}' was not found in this Google Spreadsheet. Please verify the exact Sheet Tab Name.`
        );
      }
      if (csvContent.includes("access_denied") || csvContent.includes("NOT_AUTHORIZED") || csvContent.includes("USER_NOT_AUTHORIZED")) {
        throw new BadRequestError(
          "Access denied by Google. In Google Sheets, click the blue 'Share' button and set General Access to 'Anyone with the link can view'."
        );
      }
      throw new BadRequestError(
        "Google Sheets returned an error. Please verify the spreadsheet URL and ensure it is shared with 'Anyone with the link can view'."
      );
    }

    if (!csvContent || csvContent.trim().length === 0) {
      throw new BadRequestError("The Google Sheet was reached, but it returned an empty table.");
    }

    return csvContent;
  }
}
