"use client";

import React, { useEffect, useState } from "react";
import {
  Package,
  Plus,
  Search,
  Tag,
  Filter,
  Layers,
  CheckCircle2,
  Trash2,
  AlertCircle,
  UploadCloud,
} from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States/States";
import { BulkImportModal } from "@/components/catalog/BulkImportModal";
import { Product } from "@/types/commerce";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkImportModalOpen, setIsBulkImportModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // New Product form fields
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [initialStock, setInitialStock] = useState("10");
  const [description, setDescription] = useState("");

  const loadProducts = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/v1/products?limit=100");
      if (res.ok) {
        const json = await res.json();
        setProducts(json.data || []);
      }
    } catch (err) {
      console.error("Failed to load products:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!name.trim()) {
      setFormError("Product name is required.");
      return;
    }
    const priceNum = parseFloat(basePrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError("A valid positive base price is required.");
      return;
    }

    const generatedSku = sku.trim() || `SKU-${name.slice(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sku: generatedSku,
          base_price: priceNum,
          compare_at_price: compareAtPrice ? parseFloat(compareAtPrice) : undefined,
          initial_stock: parseInt(initialStock, 10) || 0,
          description: description.trim(),
          status: "ACTIVE",
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || "Failed to create product");
      }

      // Success
      setIsModalOpen(false);
      setName("");
      setSku("");
      setBasePrice("");
      setCompareAtPrice("");
      setDescription("");
      setInitialStock("10");
      await loadProducts();
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (productId: string) => {
    if (!confirm("Are you sure you want to archive this product?")) return;
    try {
      const res = await fetch(`/api/v1/products/${productId}`, { method: "DELETE" });
      if (res.ok) {
        await loadProducts();
      }
    } catch (err) {
      console.error("Failed to archive product:", err);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Product Catalog &amp; SKUs</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Authoritative multi-variant product catalog, attributes, and pricing.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="outline" size="md" onClick={() => setIsBulkImportModalOpen(true)}>
            <UploadCloud size={16} style={{ marginRight: 6 }} /> Import Catalog (CSV)
          </Button>
          <Button variant="primary" size="md" onClick={() => setIsModalOpen(true)}>
            <Plus size={16} style={{ marginRight: 6 }} /> Add Product
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 300px" }}>
          <Input
            placeholder="Search by title or SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search size={16} color="var(--color-text-muted)" />}
          />
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {["ALL", "ACTIVE", "DRAFT", "ARCHIVED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "8px 14px",
                borderRadius: "var(--radius-control)",
                fontSize: "12px",
                fontWeight: 600,
                border: "1px solid var(--color-border-subtle)",
                background: statusFilter === s ? "var(--color-charcoal)" : "transparent",
                color: statusFilter === s ? "var(--color-lime)" : "var(--color-text-secondary)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Table */}
      <BentoCard span={12} title="Catalog Items" subtitle={`Displaying ${filteredProducts.length} items`}>
        {isLoading ? (
          <LoadingState message="Fetching catalog from authoritative database..." />
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            icon={<Package size={36} color="var(--color-lime-hover)" />}
            title="No products found"
            description="Add products to your catalog to unlock inventory tracking, checkout, and AI recommendations."
            actionText="+ Add First Product"
            onAction={() => setIsModalOpen(true)}
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-subtle)", textAlign: "left" }}>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Product</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>SKU</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Price</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Variants</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Status</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)", textAlign: "right" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    style={{
                      borderBottom: "1px solid var(--color-border-subtle)",
                      opacity: product.status === "ARCHIVED" ? 0.6 : 1,
                    }}
                  >
                    <td style={{ padding: "14px 10px", fontWeight: 600 }}>
                      <div>{product.name}</div>
                      {product.description && (
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 400 }}>
                          {product.description.slice(0, 60)}...
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <code>{product.sku}</code>
                    </td>
                    <td style={{ padding: "14px 10px", fontWeight: 600 }}>
                      {product.base_price.toLocaleString("en-BD")} ৳
                      {product.compare_at_price && (
                        <span
                          style={{
                            fontSize: "11px",
                            color: "var(--color-text-muted)",
                            textDecoration: "line-through",
                            marginLeft: "6px",
                          }}
                        >
                          {product.compare_at_price.toLocaleString("en-BD")} ৳
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <Layers size={14} color="var(--color-text-muted)" />
                        {product.variants?.length || 1}
                      </span>
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <Badge variant={product.status === "ACTIVE" ? "active" : "inactive"}>
                        {product.status}
                      </Badge>
                    </td>
                    <td style={{ padding: "14px 10px", textAlign: "right" }}>
                      {product.status !== "ARCHIVED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchive(product.id)}
                          style={{ color: "var(--color-danger)" }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      {/* Add Product Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Product">
        <form onSubmit={handleCreateProduct} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {formError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px",
                background: "rgba(239, 68, 68, 0.1)",
                color: "var(--color-danger)",
                borderRadius: "var(--radius-control)",
                fontSize: "13px",
              }}
            >
              <AlertCircle size={16} />
              <span>{formError}</span>
            </div>
          )}

          <Input
            label="Product Title *"
            placeholder="e.g. Traditional Panjabi - Midnight Blue"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Input
              label="SKU (Leave blank to auto-generate)"
              placeholder="e.g. PAN-BLU-001"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
            <Input
              label="Initial Stock *"
              type="number"
              min="0"
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Input
              label="Base Price (BDT ৳) *"
              type="number"
              min="1"
              placeholder="1500"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              required
            />
            <Input
              label="Compare At Price (BDT ৳)"
              type="number"
              placeholder="1800"
              value={compareAtPrice}
              onChange={(e) => setCompareAtPrice(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 500 }}>Description</label>
            <textarea
              rows={3}
              placeholder="Detailed product specifications..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                padding: "10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--color-border-subtle)",
                fontFamily: "inherit",
                fontSize: "13px",
                background: "var(--color-bg-primary)",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Create Product
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bulk Catalog Import Modal */}
      <BulkImportModal
        isOpen={isBulkImportModalOpen}
        onClose={() => setIsBulkImportModalOpen(false)}
        onSuccess={loadProducts}
      />
    </>
  );
}
