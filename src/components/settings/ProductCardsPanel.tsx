"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Switch } from "@/components/ui/Switch/Switch";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { ProductCardList } from "@/components/social/ProductCardList";
import type { Product } from "@/types/commerce";
import type { ProductCard, ProductCardTheme } from "@/types/social";
import styles from "./ProductCardsPanel.module.css";

/** The template as GET/PUT /api/v1/tenants/current/product-cards carry it (product-card-settings.ts). */
interface CardSettings {
  enabled: boolean;
  channels: Record<ChannelKey, boolean>;
  max_cards: number;
  button_label_latin: string;
  button_label_bangla: string;
  show_photo: boolean;
  show_regular_price: boolean;
  show_out_of_stock: boolean;
  theme: ProductCardTheme;
}

type ChannelKey = "FACEBOOK_MESSENGER" | "INSTAGRAM" | "WHATSAPP" | "WEBSITE_CHAT" | "TELEGRAM";

interface ApiError {
  message: string;
  requestId?: string;
  status: number;
}

const CHANNELS: Array<{ key: ChannelKey; label: string; note: string }> = [
  { key: "FACEBOOK_MESSENGER", label: "Facebook Messenger", note: "Swipeable cards" },
  { key: "INSTAGRAM", label: "Instagram", note: "Swipeable cards" },
  { key: "WHATSAPP", label: "WhatsApp", note: "One message per product, at most 3" },
  { key: "WEBSITE_CHAT", label: "Website chat", note: "Cards in the chat widget" },
  { key: "TELEGRAM", label: "Telegram", note: "One message per product, at most 3" },
];

const THEMES: Array<{ key: ProductCardTheme; label: string }> = [
  { key: "lime", label: "Lime" },
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err: ApiError = { status: res.status, message: body?.error?.message ?? "Something went wrong.", requestId: body?.error?.request_id };
    throw err;
  }
  return body?.data as T;
}

const asError = (err: unknown): ApiError =>
  typeof err === "object" && err && "status" in err ? (err as ApiError) : { status: 0, message: "Couldn't reach CommerceOS. Check your connection." };

const labelProblem = (label: string): string | null => {
  const v = label.trim();
  if (!v) return "Enter the button text.";
  if (v.length > 20) return "At most 20 characters: Messenger and WhatsApp cut longer buttons.";
  if (/[|<>]|https?:/i.test(v) || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v)) return "Plain text only.";
  return null;
};

/**
 * Settings → Product cards: how the AI agent's product cards look to customers. Changes only presentation; price,
 * stock and name always come from the catalog. The preview uses one of the shop's products when there is one.
 */
export function ProductCardsPanel() {
  const [saved, setSaved] = useState<CardSettings | null>(null);
  const [draft, setDraft] = useState<CardSettings | null>(null);
  const [defaults, setDefaults] = useState<CardSettings | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [sample, setSample] = useState<Product | null>(null);
  const [previewScript, setPreviewScript] = useState<"latin" | "bangla">("latin");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await call<{ settings: CardSettings; defaults: CardSettings }>("/api/v1/tenants/current/product-cards");
      setSaved(data.settings);
      setDraft(data.settings);
      setDefaults(data.defaults);
    } catch (err) {
      setLoadError(asError(err));
    }
    // A real product for the preview; without one the preview shows a labelled example
    try {
      const res = await fetch("/api/v1/products?limit=10&status=ACTIVE", { credentials: "include" });
      const json = await res.json().catch(() => null);
      const products: Product[] = Array.isArray(json?.data) ? json.data : [];
      setSample(products.find((p) => p.primary_image || p.images?.length) ?? products[0] ?? null);
    } catch {
      setSample(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  const problems = draft ? { latin: labelProblem(draft.button_label_latin), bangla: labelProblem(draft.button_label_bangla) } : { latin: null, bangla: null };

  const preview = useMemo<ProductCard[]>(() => {
    if (!draft) return [];
    const bangla = previewScript === "bangla";
    const label = bangla ? draft.button_label_bangla : draft.button_label_latin;
    const base = sample?.base_price ?? 1500;
    const regular = sample ? sample.compare_at_price : 1800;
    const first: ProductCard = {
      product_id: sample?.id ?? "example",
      title: sample?.name ?? "Example: Blue Silk Panjabi",
      price_bdt: base,
      price_varies: false,
      ...(draft.show_regular_price && regular && regular > base ? { regular_price_bdt: regular } : {}),
      in_stock: true,
      image_url: draft.show_photo ? (sample?.primary_image || sample?.images?.[0]) || undefined : undefined,
      button_label: label.trim() || (bangla ? "অর্ডার করুন" : "Order now"),
      button_payload: "",
      script: previewScript,
      theme: draft.theme,
    };
    const soldOut: ProductCard = {
      ...first,
      product_id: "example_sold_out",
      title: bangla ? "উদাহরণ: স্টকে নেই এমন পণ্য" : "Example: a sold-out product",
      regular_price_bdt: undefined,
      image_url: undefined,
      in_stock: false,
      button_label: bangla ? "স্টকে নেই" : "Out of stock",
    };
    return draft.show_out_of_stock ? [first, soldOut] : [first];
  }, [draft, sample, previewScript]);

  const save = async () => {
    if (!draft || problems.latin || problems.bangla) return;
    setSaving(true);
    setNotice(null);
    try {
      const data = await call<{ settings: CardSettings }>("/api/v1/tenants/current/product-cards", { method: "PUT", body: JSON.stringify(draft) });
      setSaved(data.settings);
      setDraft(data.settings);
      setNotice({ tone: "success", text: "Saved. New product cards use this template." });
    } catch (err) {
      const e = asError(err);
      setNotice({ tone: "error", text: e.status === 403 ? "Your role can't change settings (settings.update)." : e.message });
    } finally {
      setSaving(false);
    }
  };

  if (loadError?.status === 403) return <PermissionDenied resource="product card settings" requiredPermission="settings.read" />;
  if (loadError) return <ErrorState title="Couldn't load product card settings" message={loadError.message} requestId={loadError.requestId} onRetry={load} />;
  if (!draft) return <LoadingSkeleton lines={6} />;

  const set = <K extends keyof CardSettings>(key: K, value: CardSettings[K]) => setDraft({ ...draft, [key]: value });

  return (
    <div className={styles.panel}>
      <div aria-live="polite" className={styles.live}>
        {notice && (
          <p className={`${styles.notice} ${notice.tone === "success" ? styles.noticeSuccess : styles.noticeError}`}>
            {notice.tone === "success" && <CheckCircle2 size={16} />}
            {notice.text}
          </p>
        )}
      </div>

      <BentoGrid>
        <BentoCard span={7} title="Product card template" subtitle="When the AI agent finds products, it sends them as cards after its reply">
          <div className={styles.form}>
            <div className={styles.row}>
              <div>
                <div className={styles.rowTitle}>Send product cards</div>
                <div className={styles.rowHint}>Off: customers get the text reply only.</div>
              </div>
              <Switch checked={draft.enabled} onChange={(v) => set("enabled", v)} label="Send product cards" />
            </div>

            <fieldset className={styles.fieldset} disabled={!draft.enabled}>
              <legend className={styles.legend}>Channels</legend>
              {CHANNELS.map((c) => (
                <div key={c.key} className={styles.row}>
                  <div>
                    <div className={styles.rowTitle}>{c.label}</div>
                    <div className={styles.rowHint}>{c.note}</div>
                  </div>
                  <Switch
                    checked={draft.channels[c.key]}
                    onChange={(v) => set("channels", { ...draft.channels, [c.key]: v })}
                    label={`Cards on ${c.label}`}
                    disabled={!draft.enabled}
                    size="sm"
                  />
                </div>
              ))}
              <p className={styles.rowHint}>Telegram doesn&apos;t show cards; the text reply lists the products there.</p>
            </fieldset>

            <fieldset className={styles.fieldset} disabled={!draft.enabled}>
              <legend className={styles.legend}>Button</legend>
              <div className={styles.labels}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>English / Banglish customers</span>
                  <input
                    className={styles.input}
                    value={draft.button_label_latin}
                    maxLength={30}
                    onChange={(e) => set("button_label_latin", e.target.value)}
                    aria-invalid={Boolean(problems.latin)}
                  />
                  <span className={problems.latin ? styles.fieldError : styles.fieldHint}>{problems.latin ?? `${draft.button_label_latin.trim().length}/20`}</span>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Bangla customers</span>
                  <input
                    className={styles.input}
                    value={draft.button_label_bangla}
                    maxLength={30}
                    onChange={(e) => set("button_label_bangla", e.target.value)}
                    aria-invalid={Boolean(problems.bangla)}
                  />
                  <span className={problems.bangla ? styles.fieldError : styles.fieldHint}>{problems.bangla ?? `${draft.button_label_bangla.trim().length}/20`}</span>
                </label>
              </div>
              <p className={styles.rowHint}>A tap always asks the agent about that product; it never confirms an order on its own.</p>
            </fieldset>

            <fieldset className={styles.fieldset} disabled={!draft.enabled}>
              <legend className={styles.legend}>What a card shows</legend>
              <div className={styles.row}>
                <div className={styles.rowTitle}>Product photo</div>
                <Switch checked={draft.show_photo} onChange={(v) => set("show_photo", v)} label="Show product photo" disabled={!draft.enabled} size="sm" />
              </div>
              <div className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Crossed-out regular price</div>
                  <div className={styles.rowHint}>When the product has a higher &quot;compare at&quot; price.</div>
                </div>
                <Switch checked={draft.show_regular_price} onChange={(v) => set("show_regular_price", v)} label="Show regular price" disabled={!draft.enabled} size="sm" />
              </div>
              <div className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Sold-out products</div>
                  <div className={styles.rowHint}>Off: products with nothing in stock get no card.</div>
                </div>
                <Switch checked={draft.show_out_of_stock} onChange={(v) => set("show_out_of_stock", v)} label="Show sold-out products" disabled={!draft.enabled} size="sm" />
              </div>
              <label className={styles.row}>
                <span className={styles.rowTitle}>Cards per reply</span>
                <select className={styles.select} value={draft.max_cards} onChange={(e) => set("max_cards", Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className={styles.fieldset} disabled={!draft.enabled}>
              <legend className={styles.legend}>Look (website chat and your inbox)</legend>
              <div className={styles.themes} role="radiogroup" aria-label="Card look">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={draft.theme === t.key}
                    className={`${styles.themeOption} ${draft.theme === t.key ? styles.themeActive : ""}`}
                    onClick={() => set("theme", t.key)}
                  >
                    <span className={`${styles.swatch} ${styles[`swatch_${t.key}`]}`} aria-hidden />
                    {t.label}
                  </button>
                ))}
              </div>
              <p className={styles.rowHint}>Messenger, Instagram and WhatsApp draw cards in their own style.</p>
            </fieldset>

            <div className={styles.actions}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => defaults && setDraft(defaults)}
                disabled={!defaults || JSON.stringify(defaults) === JSON.stringify(draft)}
              >
                <RotateCcw size={14} style={{ marginRight: 6 }} /> Reset to defaults
              </Button>
              <Button variant="outline" size="md" type="button" onClick={() => setDraft(saved)} disabled={!dirty || saving}>
                Discard
              </Button>
              <Button variant="primary" size="md" type="button" onClick={save} isLoading={saving} disabled={!dirty || Boolean(problems.latin || problems.bangla)}>
                Save template
              </Button>
            </div>
          </div>
        </BentoCard>

        <BentoCard span={5} title="Preview" subtitle={sample ? `Using your product “${sample.name}”` : "Example product (add products to preview your own)"}>
          <div className={styles.previewTabs} role="tablist" aria-label="Preview language">
            {(["latin", "bangla"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={previewScript === s}
                className={`${styles.previewTab} ${previewScript === s ? styles.previewTabActive : ""}`}
                onClick={() => setPreviewScript(s)}
              >
                {s === "latin" ? "English / Banglish" : "বাংলা"}
              </button>
            ))}
          </div>
          <div className={styles.previewChat}>
            {draft.enabled ? (
              <>
                <div className={styles.previewBubble}>{previewScript === "bangla" ? "জি, এই পণ্যটি আছে। নিচে দেখুন।" : "Ji, eta ache. Niche dekhun."}</div>
                <ProductCardList cards={preview} onOrder={() => undefined} />
              </>
            ) : (
              <p className={styles.rowHint}>Cards are off: customers get the text reply only.</p>
            )}
          </div>
        </BentoCard>
      </BentoGrid>
    </div>
  );
}
