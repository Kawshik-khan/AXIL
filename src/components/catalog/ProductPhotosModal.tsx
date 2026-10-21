"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Button } from "@/components/ui/Button/Button";
import { ProductImageUploader } from "./ProductImageUploader";
import type { Product } from "@/types/commerce";

interface ProductPhotosModalProps {
  /** The product whose photos are edited; null keeps the modal closed. */
  product: Product | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/** Adds, removes and reorders an existing product's photos (PATCH /api/v1/products/{id}). */
export const ProductPhotosModal: React.FC<ProductPhotosModalProps> = ({ product, onClose, onSaved }) => {
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setImages(product?.images ?? []);
    setError("");
  }, [product]);

  if (!product) return null;

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, primary_image: images[0] ?? "" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || `Saving failed (HTTP ${res.status}).`);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Photos: ${product.name}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {error && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--color-danger)", fontSize: "13px" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <ProductImageUploader value={images} onChange={setImages} onBusyChange={setBusy} disabled={saving} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={save} isLoading={saving} disabled={busy}>
            Save Photos
          </Button>
        </div>
      </div>
    </Modal>
  );
};
