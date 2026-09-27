"use client";

import React, { useState, useEffect } from "react";
import { Search, X, Package, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import styles from "./SocialInbox.module.css";

interface ProductSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (textToInsert: string) => void;
}

export const ProductSearchModal: React.FC<ProductSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectProduct,
}) => {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    fetch(`/api/v1/products?search=${encodeURIComponent(query)}&limit=8`)
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          setProducts(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [isOpen, query]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Package size={20} color="var(--color-primary)" />
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: "var(--color-text-primary)" }}>
              Product Catalog Lookup
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className={styles.searchBox}>
          <Search size={16} color="var(--color-text-muted)" />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search products by title, SKU, category..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Product List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "400px", overflowY: "auto" }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: "20px", color: "var(--color-text-muted)" }}>
              Accessing authoritative catalog...
            </div>
          ) : products.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px", color: "var(--color-text-muted)" }}>
              No matching products found.
            </div>
          ) : (
            products.map((prod) => {
              const variants = prod.variants || [];
              return (
                <div
                  key={prod.id}
                  style={{
                    background: "var(--color-surface-hover)",
                    borderRadius: "8px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--color-text-primary)", fontSize: "0.875rem" }}>
                        {prod.name}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                        SKU: {prod.sku} • Base Price: ৳{prod.base_price}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const snippet = `পণ্য: ${prod.name}\nমূল্য: ৳${prod.base_price}\nস্ট্যাটাস: ${prod.status}`;
                        onSelectProduct(snippet);
                        onClose();
                      }}
                    >
                      <Copy size={12} style={{ marginRight: "4px" }} /> Insert
                    </Button>
                  </div>

                  {variants.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {variants.map((v: any) => (
                        <div
                          key={v.id}
                          style={{
                            fontSize: "0.6875rem",
                            background: "rgba(255, 255, 255, 0.04)",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                            borderRadius: "4px",
                            padding: "3px 8px",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {v.title} — ৳{v.price}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
