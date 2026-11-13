"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { findDistrict } from "@/lib/bd-geography";
import { formatBdt } from "@/components/payments/api";
import { SidePanel } from "@/components/ui/WorkScreen/SidePanel";
import type { PaymentMethod } from "@/types/commerce";
import { DistrictPicker, useDeliveryFees } from "./DistrictPicker";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";
import styles from "./OrderPanels.module.css";

interface VariantOption {
  id: string;
  title: string;
  sku?: string;
  price: number;
}

interface ProductOption {
  id: string;
  name: string;
  variants?: VariantOption[];
}

/** "Panjabi · XL", or just the variant's own title when it already names the product. */
function variantLabel(productName: string, variantTitle: string | undefined): string {
  const title = variantTitle?.trim();
  if (!title || title === "Default" || title === "Default Title") return productName;
  const stem = productName.slice(0, 12).toLowerCase();
  return title.toLowerCase().startsWith(stem) ? title : `${productName} · ${title}`;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "COD", label: "Cash on delivery" },
  { value: "BKASH", label: "bKash" },
  { value: "NAGAD", label: "Nagad" },
];

/**
 * Take an order by hand (phone call, walk-in, a chat outside CommerceOS). The server prices it, applies the coupon,
 * works out the delivery zone from the district and reserves stock; the summary here is only a preview.
 */
export function NewOrderPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (order: { id: string; order_number: string }) => Promise<void> | void }) {
  const deliveryFees = useDeliveryFees();
  const [products, setProducts] = useState<ProductOption[] | null>(null);
  const [productsFailed, setProductsFailed] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("COD");
  const [couponCode, setCouponCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/products")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((json) => {
        if (!cancelled) setProducts(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {
        if (!cancelled) setProductsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const variants = useMemo(
    () => (products ?? []).flatMap((p) => (p.variants ?? []).map((v) => ({ ...v, label: variantLabel(p.name, v.title) }))),
    [products],
  );
  const chosen = variants.find((v) => v.id === variantId);
  const zone = findDistrict(district)?.zone;
  const deliveryFee = zone && deliveryFees ? (zone === "INSIDE_DHAKA" ? deliveryFees.inside_dhaka_bdt : deliveryFees.outside_dhaka_bdt) : null;
  const itemsTotal = chosen ? chosen.price * quantity : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!firstName.trim() || !phone.trim()) return setError("Enter the customer's name and phone number.");
    if (!district) return setError("Choose the delivery district.");
    if (!addressLine.trim()) return setError("Enter the delivery address.");
    if (!variantId) return setError("Choose a product.");
    setBusy(true);
    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { first_name: firstName.trim(), last_name: lastName.trim() || "Customer", phone: phone.trim() },
          // The server derives division and delivery zone from the district (FX-36)
          delivery_address: { district, address_line_1: addressLine.trim() },
          items: [{ variant_id: variantId, quantity }],
          payment_method: paymentMethod,
          coupon_code: couponCode.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message || "Could not create the order.");
        return;
      }
      await onCreated({ id: json?.data?.order?.id ?? "", order_number: json?.data?.order?.order_number ?? "" });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      as="form"
      onSubmit={submit}
      onClose={onClose}
      title="New order"
      subtitle="Stock is reserved when you create it. Prices, coupon and delivery charge are worked out by the shop's settings."
      footer={
        <>
          <button type="button" className={ws.textButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ws.inkButton} disabled={busy}>
            {busy ? "Creating…" : "Create order"}
          </button>
        </>
      }
    >
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Customer</legend>
        <div className={ws.fieldRow}>
          <div className={ws.field}>
            <label className={ws.fieldLabel} htmlFor="no-first">
              First name
            </label>
            <input id="no-first" className={ws.textInput} placeholder="e.g. Tanvir" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div className={ws.field}>
            <label className={ws.fieldLabel} htmlFor="no-last">
              Last name <span className={ws.fieldHint}>(optional)</span>
            </label>
            <input id="no-last" className={ws.textInput} placeholder="e.g. Hossain" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div className={ws.field}>
          <label className={ws.fieldLabel} htmlFor="no-phone">
            Mobile number
          </label>
          <input
            id="no-phone"
            className={ws.textInput}
            inputMode="tel"
            placeholder="01712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Delivery</legend>
        <div className={ws.field}>
          <DistrictPicker
            district={district}
            onChange={setDistrict}
            fees={deliveryFees}
            labelClassName={ws.fieldLabel}
            selectClassName={ws.select}
            hintClassName={ws.fieldHint}
          />
        </div>
        <div className={ws.field}>
          <label className={ws.fieldLabel} htmlFor="no-address">
            Address
          </label>
          <input
            id="no-address"
            className={ws.textInput}
            placeholder="House 12, Road 4, Sector 7, Uttara"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            required
          />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Item</legend>
        <div className={ws.field}>
          <label className={ws.fieldLabel} htmlFor="no-variant">
            Product
          </label>
          <select id="no-variant" className={ws.select} value={variantId} onChange={(e) => setVariantId(e.target.value)} required disabled={!products}>
            <option value="">{productsFailed ? "Could not load products" : !products ? "Loading products…" : variants.length ? "Choose a product" : "No products yet"}</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {formatBdt(v.price)}
              </option>
            ))}
          </select>
        </div>
        <div className={ws.field}>
          <span className={ws.fieldLabel} id="no-qty-label">
            Quantity
          </span>
          <div className={styles.stepper} role="group" aria-labelledby="no-qty-label">
            <button type="button" className={ws.iconButton} onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="One fewer" disabled={quantity <= 1}>
              <Minus size={16} />
            </button>
            <span className={styles.stepperValue} aria-live="polite">
              {quantity}
            </span>
            <button type="button" className={ws.iconButton} onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="One more">
              <Plus size={16} />
            </button>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Payment</legend>
        <div className={ws.chips} role="radiogroup" aria-label="Payment method">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={paymentMethod === m.value}
              className={`${ws.chip} ${paymentMethod === m.value ? ws.chipActive : ""}`}
              onClick={() => setPaymentMethod(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className={ws.field}>
          <label className={ws.fieldLabel} htmlFor="no-coupon">
            Coupon <span className={ws.fieldHint}>(optional)</span>
          </label>
          <input id="no-coupon" className={ws.textInput} placeholder="e.g. EID2026" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
        </div>
      </fieldset>

      <dl className={`${ws.summaryList} ${styles.preview}`} aria-label="Estimated total">
        <div>
          <dt>Items</dt>
          <dd>{itemsTotal !== null ? formatBdt(itemsTotal) : "—"}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{deliveryFee !== null ? formatBdt(deliveryFee) : "—"}</dd>
        </div>
        <div className={ws.summaryTotal}>
          <dt>Estimated total{couponCode.trim() ? ", before coupon" : ""}</dt>
          <dd>{itemsTotal !== null && deliveryFee !== null ? formatBdt(itemsTotal + deliveryFee) : "—"}</dd>
        </div>
      </dl>

      {error && (
        <p className={ws.errorText} role="alert">
          {error}
        </p>
      )}
    </SidePanel>
  );
}
