"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { ProductImageUploader } from "@/components/catalog/ProductImageUploader";
import type { Category, Product, ProductStatus } from "@/types/commerce";
import { STATUS_DISPLAY, formatTaka } from "./product-display";
import styles from "./products.module.css";

interface ProductFormModalProps {
  isOpen: boolean;
  /** The product being edited; null creates a new one. */
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** Called after a category is created from the form, so the page can refresh its list. */
  onCategoryCreated: () => Promise<void> | void;
}

/** Every status but ARCHIVED; imported OUT_OF_STOCK / DISCONTINUED stay as they are unless the merchant changes them. */
type FormStatus = Exclude<ProductStatus, "ARCHIVED">;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => ({}));
  const message = json?.error?.message || fallback;
  return json?.error?.request_id ? `${message} (request ${json.error.request_id})` : message;
}

/** Create or edit a product. Stock is set only on create; after that it changes through Inventory. */
export function ProductFormModal({ isOpen, product, categories, onClose, onSaved, onCategoryCreated }: ProductFormModalProps) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [initialStock, setInitialStock] = useState("10");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [status, setStatus] = useState<FormStatus>("ACTIVE");
  const [images, setImages] = useState<string[]>([]);
  const [imagesBusy, setImagesBusy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const categoryNameOf = (id?: string) => categories.find((c) => c.id === id)?.name ?? "";

  // Fill the form each time it opens, from the product or blank
  useEffect(() => {
    if (!isOpen) return;
    setFormError("");
    setName(product?.name ?? "");
    setSku(product?.sku ?? "");
    setBasePrice(product ? String(product.base_price) : "");
    setCompareAtPrice(product?.compare_at_price != null ? String(product.compare_at_price) : "");
    setCostPrice(product?.cost_price != null ? String(product.cost_price) : "");
    setInitialStock("10");
    setDescription(product?.description ?? "");
    setCategoryName(categoryNameOf(product?.category_id));
    setStatus(!product || product.status === "ARCHIVED" ? "ACTIVE" : product.status);
    setImages(product?.images ?? []);
    // categories only seed the category name; a later refresh must not wipe what the merchant typed
  }, [isOpen, product]);

  const priceNum = parseFloat(basePrice);
  const costNum = parseFloat(costPrice);
  const margin =
    !isNaN(priceNum) && priceNum > 0 && !isNaN(costNum) && costNum >= 0
      ? { amount: priceNum - costNum, percent: Math.round(((priceNum - costNum) / priceNum) * 100) }
      : null;

  /** The chosen category's id: an existing one by name, or a new one created now. Customers browse the shop by category. */
  const resolveCategoryId = async (): Promise<string | undefined> => {
    const wanted = categoryName.trim();
    if (!wanted) return undefined;
    const existing = categories.find((c) => c.name.toLowerCase() === wanted.toLowerCase());
    if (existing) return existing.id;
    const res = await fetch("/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: wanted }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to create the category"));
    const json = await res.json();
    await onCategoryCreated();
    return json.data?.category?.id;
  };

  /** Checks shared by create and edit; returns an error message or null. */
  const validate = (): string | null => {
    if (!name.trim()) return "Product name is required.";
    if (product && !sku.trim()) return "SKU is required.";
    if (imagesBusy) return "Wait for the photos to finish uploading.";
    if (isNaN(priceNum) || priceNum <= 0) return "A valid positive price is required.";
    if (compareAtPrice.trim() && (isNaN(parseFloat(compareAtPrice)) || parseFloat(compareAtPrice) < 0))
      return "Compare-at price must be a positive number or empty.";
    if (costPrice.trim() && (isNaN(costNum) || costNum < 0)) return "Cost price must be a positive number or empty.";
    return null;
  };

  const create = async () => {
    const suffix = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
    const generatedSku = sku.trim() || `SKU-${name.trim().slice(0, 3).toUpperCase()}-${suffix}`;
    const categoryId = await resolveCategoryId();
    const res = await fetch("/api/v1/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        sku: generatedSku,
        base_price: priceNum,
        compare_at_price: compareAtPrice.trim() ? parseFloat(compareAtPrice) : undefined,
        cost_price: costPrice.trim() ? costNum : undefined,
        initial_stock: parseInt(initialStock, 10) || 0,
        description: description.trim(),
        category_id: categoryId,
        images,
        status,
      }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to create product"));
  };

  /** Sends only the fields that changed. */
  const update = async (original: Product) => {
    const compareNum = compareAtPrice.trim() ? parseFloat(compareAtPrice) : null;
    const costValue = costPrice.trim() ? costNum : null;
    const patch: Record<string, unknown> = {};
    if (name.trim() !== original.name) patch.name = name.trim();
    if (sku.trim() !== original.sku) patch.sku = sku.trim();
    if (priceNum !== original.base_price) patch.base_price = priceNum;
    if (compareNum !== (original.compare_at_price ?? null)) patch.compare_at_price = compareNum;
    if (costValue !== (original.cost_price ?? null)) patch.cost_price = costValue;
    if (description.trim() !== (original.description ?? "")) patch.description = description.trim();
    if (original.status !== "ARCHIVED" && status !== original.status) patch.status = status;
    // Only touch the category when the field changed, so a category missing from the list is never cleared
    if (categoryName.trim() !== categoryNameOf(original.category_id)) {
      patch.category_id = (await resolveCategoryId()) ?? null;
    }
    const originalImages = original.images ?? [];
    if (images.length !== originalImages.length || images.some((url, i) => url !== originalImages[i])) {
      patch.images = images;
      patch.primary_image = images[0] ?? "";
    }
    if (Object.keys(patch).length === 0) return;
    const res = await fetch(`/api/v1/products/${encodeURIComponent(original.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to update product"));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    try {
      setIsSubmitting(true);
      if (product) await update(product);
      else await create();
      onClose();
      await onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={product ? "Edit product" : "New product"}>
      <form onSubmit={handleSubmit} className={styles.form}>
        {formError && (
          <div className={styles.formError} role="alert">
            <AlertCircle size={16} />
            <span>{formError}</span>
          </div>
        )}

        <Input
          label="Product name *"
          placeholder="e.g. Traditional Panjabi - Midnight Blue"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className={styles.formRow}>
          <Input
            label={product ? "SKU *" : "SKU"}
            placeholder="e.g. PAN-BLU-001"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            required={Boolean(product)}
            hint={product ? undefined : "Leave blank to generate one."}
          />
          {product ? (
            <Input label="Stock" value="Managed in Inventory" disabled hint="Change stock from the Inventory page." />
          ) : (
            <Input
              label="Opening stock *"
              type="number"
              min="0"
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              required
            />
          )}
        </div>

        <div className={styles.formRow3}>
          <Input
            label="Price (৳) *"
            type="number"
            min="1"
            step="any"
            placeholder="1500"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            required
          />
          <Input
            label="Compare-at (৳)"
            type="number"
            min="0"
            step="any"
            placeholder="1800"
            value={compareAtPrice}
            onChange={(e) => setCompareAtPrice(e.target.value)}
          />
          <Input
            label="Cost (৳)"
            type="number"
            min="0"
            step="any"
            placeholder="900"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
          />
        </div>
        {margin && (
          <p className={margin.amount < 0 ? `${styles.marginNote} ${styles.marginLoss}` : styles.marginNote}>
            {margin.amount < 0 ? "Loss" : "Margin"} {formatTaka(Math.abs(margin.amount))} per unit ({margin.percent}%)
          </p>
        )}

        <div className={styles.formRow}>
          <Input
            label="Category"
            placeholder="e.g. Panjabi, Saree, Shoes"
            list="product-categories"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            hint="Pick one or type a new one."
            maxLength={80}
          />
          {product?.status === "ARCHIVED" ? (
            <Input label="Status" value="Archived" disabled hint="Restore it from the list first." />
          ) : (
            <label className={styles.field}>
              Status
              <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as FormStatus)}>
                <option value="ACTIVE">Active: customers can order it</option>
                <option value="DRAFT">Draft: hidden from customers</option>
                {product && (product.status === "OUT_OF_STOCK" || product.status === "DISCONTINUED") && (
                  <option value={product.status}>{STATUS_DISPLAY[product.status]} (as imported)</option>
                )}
              </select>
            </label>
          )}
        </div>
        <datalist id="product-categories">
          {categories.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>

        <ProductImageUploader value={images} onChange={setImages} onBusyChange={setImagesBusy} disabled={isSubmitting} />

        <label className={styles.field}>
          Description
          <textarea
            rows={3}
            className={styles.textarea}
            placeholder="Fabric, sizes, care: what a customer asks before buying"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className={styles.formActions}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isLoading={isSubmitting} disabled={imagesBusy}>
            {product ? "Save changes" : "Create product"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
