/**
 * CommerceOS — Memory-Safe RFC-4180 CSV Parser & Serializer
 * Zero external dependencies. Handles quotes, commas, multiline values, BOM, and Banglish headers.
 */

export interface ParsedCsvRow {
  [key: string]: string;
}

export class CsvParser {
  /**
   * Parse a raw CSV string into an array of key-value row objects
   */
  public static parse(csvContent: string): { headers: string[]; rows: ParsedCsvRow[] } {
    if (!csvContent || typeof csvContent !== "string") {
      return { headers: [], rows: [] };
    }

    // Strip UTF-8 BOM if present
    let cleanContent = csvContent.replace(/^\uFEFF/, "").trim();
    if (!cleanContent) {
      return { headers: [], rows: [] };
    }

    const lines: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let insideQuotes = false;

    for (let i = 0; i < cleanContent.length; i++) {
      const char = cleanContent[i];
      const nextChar = cleanContent[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          // Escaped quote ("")
          currentField += '"';
          i++; // skip next quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if ((char === "\r" || char === "\n") && !insideQuotes) {
        // Handle CRLF or LF
        if (char === "\r" && nextChar === "\n") {
          i++;
        }
        currentRow.push(currentField.trim());
        currentField = "";
        if (currentRow.some((f) => f.length > 0)) {
          lines.push(currentRow);
        }
        currentRow = [];
      } else {
        currentField += char;
      }
    }

    // Push trailing row if any
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some((f) => f.length > 0)) {
        lines.push(currentRow);
      }
    }

    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    const rawHeaders = lines[0];
    const headers = rawHeaders.map((h) => this.normalizeHeader(h));
    const rows: ParsedCsvRow[] = [];

    for (let r = 1; r < lines.length; r++) {
      const values = lines[r];
      // Skip blank rows
      if (values.every((v) => !v || v.trim().length === 0)) continue;

      const rowObj: ParsedCsvRow = {};
      for (let c = 0; c < headers.length; c++) {
        const header = headers[c];
        rowObj[header] = values[c] !== undefined ? values[c] : "";
      }
      rows.push(rowObj);
    }

    return { headers, rows };
  }

  /**
   * Serialize array of objects into standard RFC-4180 CSV
   */
  public static stringify(records: Record<string, any>[], customHeaders?: { key: string; label: string }[]): string {
    if (!records || records.length === 0) {
      return "";
    }

    const headerKeys = customHeaders
      ? customHeaders.map((h) => h.key)
      : Object.keys(records[0]);
    const headerLabels = customHeaders
      ? customHeaders.map((h) => h.label)
      : headerKeys;

    const escapeField = (val: any): string => {
      if (val === null || val === undefined) return "";
      let str = typeof val === "object" ? JSON.stringify(val) : String(val);
      if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
        str = `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = headerLabels.map(escapeField).join(",");
    const rows = records.map((record) =>
      headerKeys.map((key) => escapeField(record[key])).join(",")
    );

    return [headerLine, ...rows].join("\r\n");
  }

  /**
   * Normalize user-provided header into canonical catalog attribute
   */
  public static normalizeHeader(rawHeader: string): string {
    const cleaned = rawHeader
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const mappings: Record<string, string> = {
      title: "title",
      product_name: "title",
      product_title: "title",
      productname: "title",
      name: "title",
      item_name: "title",
      item_title: "title",

      sku: "sku",
      item_code: "sku",
      product_code: "sku",
      barcode: "sku",
      code: "sku",

      price: "base_price",
      price_bdt: "base_price",
      base_price: "base_price",
      baseprice: "base_price",
      unit_price: "base_price",
      regular_price: "base_price",
      sale_price: "base_price",
      selling_price: "base_price",
      mrp: "base_price",

      compare_at_price: "compare_at_price",
      compare_price: "compare_at_price",
      compareprice: "compare_at_price",
      compareatprice: "compare_at_price",
      old_price: "compare_at_price",
      original_price: "compare_at_price",
      discounted_from: "compare_at_price",

      cost_price: "cost_price",
      costprice: "cost_price",
      cost: "cost_price",
      purchase_price: "cost_price",
      buying_price: "cost_price",

      stock: "stock",
      quantity: "stock",
      qty: "stock",
      initial_stock: "stock",
      initialstock: "stock",
      inventory: "stock",
      units: "stock",

      category: "category",
      category_name: "category",
      collection: "category",
      type: "category",

      brand: "brand",
      brand_name: "brand",
      manufacturer: "brand",

      description: "description",
      desc: "description",
      details: "description",
      product_details: "description",

      short_description: "short_description",
      summary: "short_description",

      image: "images",
      images: "images",
      image_urls: "images",
      photo: "images",
      photos: "images",

      warehouse: "warehouse_code",
      warehouse_code: "warehouse_code",
      location: "warehouse_code",

      status: "status",
      is_active: "status",
    };

    return mappings[cleaned] || cleaned;
  }
}
