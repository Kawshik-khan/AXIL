import { CsvParser } from "@/lib/csv-parser";

export async function GET() {
  const templateHeaders = [
    { key: "Title", label: "Title" },
    { key: "SKU", label: "SKU" },
    { key: "Price", label: "Price (BDT)" },
    { key: "ComparePrice", label: "Compare At Price" },
    { key: "CostPrice", label: "Cost Price" },
    { key: "Stock", label: "Initial Stock" },
    { key: "Category", label: "Category" },
    { key: "Brand", label: "Brand" },
    { key: "Description", label: "Description" },
    { key: "Images", label: "Image URLs (comma-separated)" },
    { key: "Status", label: "Status" },
  ];

  const sampleRows = [
    {
      Title: "Premium Embroidered Cotton Panjabi",
      SKU: "SKU-PANJ-001",
      Price: 1850,
      ComparePrice: 2200,
      CostPrice: 1100,
      Stock: 25,
      Category: "Men's Ethnic Wear",
      Brand: "Aarong Artisan",
      Description: "100% fine cotton traditional panjabi with intricate neckline embroidery, perfect for Eid and weddings.",
      Images: "https://images.unsplash.com/photo-1597983073493-88cd35cf93b0,https://images.unsplash.com/photo-1583743814966-8936f5b7be1a",
      Status: "ACTIVE",
    },
    {
      Title: "Traditional Dhakai Jamdani Saree",
      SKU: "SKU-SAREE-002",
      Price: 4800,
      ComparePrice: 5500,
      CostPrice: 3100,
      Stock: 15,
      Category: "Women's Ethnic",
      Brand: "Dhaka Heritage",
      Description: "Handloom woven geometric pattern Jamdani saree on pure cotton resham thread.",
      Images: "https://images.unsplash.com/photo-1610030469983-98e550d6193c",
      Status: "ACTIVE",
    },
    {
      Title: "Slim Fit Casual Oxford Shirt",
      SKU: "SKU-SHIRT-003",
      Price: 1250,
      ComparePrice: 1500,
      CostPrice: 750,
      Stock: 40,
      Category: "Men's Casual",
      Brand: "Urban Artisan",
      Description: "Breathable oxford cotton button-down collar casual shirt for everyday office and smart casual wear.",
      Images: "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf",
      Status: "ACTIVE",
    },
  ];

  const csv = CsvParser.stringify(sampleRows, templateHeaders);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="commerceos-product-import-template.csv"',
      "Cache-Control": "no-cache",
    },
  });
}
