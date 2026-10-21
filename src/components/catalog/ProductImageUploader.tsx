"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, X } from "lucide-react";
import { shrinkImageForUpload } from "@/lib/client-image";
import styles from "./ProductImageUploader.module.css";

/**
 * Product photo picker (ADR-120): pick, drop or (on a phone) take photos; each is shrunk in the browser and uploaded
 * to POST /api/v1/media/product-images. `value` holds the uploaded URLs; the first one is the cover photo.
 */

interface PendingUpload {
  id: string;
  previewUrl: string;
  name: string;
  error?: string;
}

interface ProductImageUploaderProps {
  value: string[];
  onChange: (urls: string[]) => void;
  /** Called with true while any upload is still running, so the form can wait before saving. */
  onBusyChange?: (busy: boolean) => void;
  max?: number;
  disabled?: boolean;
}

async function uploadOne(file: File): Promise<string> {
  const body = await shrinkImageForUpload(file);
  const res = await fetch("/api/v1/media/product-images", {
    method: "POST",
    headers: { "Content-Type": body.type },
    body,
  });
  const json = await res.json().catch(() => null);
  const url: unknown = json?.data?.image?.url;
  if (!res.ok || typeof url !== "string") {
    throw new Error(json?.error?.message || `Upload failed (HTTP ${res.status}).`);
  }
  return url;
}

export const ProductImageUploader: React.FC<ProductImageUploaderProps> = ({ value, onChange, onBusyChange, max = 10, disabled = false }) => {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Uploads finish in any order; always append to the latest list
  const valueRef = useRef(value);
  valueRef.current = value;

  const busy = pending.some((p) => !p.error);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Free the previews still shown when the form closes
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const room = max - value.length - pending.filter((p) => !p.error).length;

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type === "");
    const accepted = list.slice(0, Math.max(0, room));
    accepted.forEach((file) => {
      const item: PendingUpload = { id: crypto.randomUUID(), previewUrl: URL.createObjectURL(file), name: file.name };
      setPending((prev) => [...prev, item]);
      uploadOne(file)
        .then((url) => {
          if (!valueRef.current.includes(url)) onChange([...valueRef.current, url]);
          URL.revokeObjectURL(item.previewUrl);
          setPending((prev) => prev.filter((p) => p.id !== item.id));
        })
        .catch((err: Error) => {
          setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, error: err.message } : p)));
        });
    });
  };

  const move = (index: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const dismiss = (id: string) => {
    setPending((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.label}>
        Product photos <span className={styles.hint}>({value.length}/{max}, first one is the cover)</span>
      </div>

      {(value.length > 0 || pending.length > 0) && (
        <ul className={styles.grid}>
          {value.map((url, i) => (
            <li key={url} className={styles.tile}>
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded files come from the media bucket, not next/image */}
              <img src={url} alt={`Product photo ${i + 1}`} className={styles.thumb} />
              {i === 0 && (
                <span className={styles.cover}>
                  <Star size={10} /> Cover
                </span>
              )}
              <div className={styles.tileActions}>
                <button type="button" className={styles.iconBtn} onClick={() => move(i, i - 1)} disabled={disabled || i === 0} aria-label={`Move photo ${i + 1} left`}>
                  <ArrowLeft size={12} />
                </button>
                <button type="button" className={styles.iconBtn} onClick={() => move(i, i + 1)} disabled={disabled || i === value.length - 1} aria-label={`Move photo ${i + 1} right`}>
                  <ArrowRight size={12} />
                </button>
                <button type="button" className={styles.iconBtn} onClick={() => onChange(value.filter((u) => u !== url))} disabled={disabled} aria-label={`Remove photo ${i + 1}`}>
                  <X size={12} />
                </button>
              </div>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className={`${styles.tile} ${p.error ? styles.tileError : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the file being uploaded */}
              <img src={p.previewUrl} alt={`Uploading ${p.name}`} className={`${styles.thumb} ${styles.dim}`} />
              {p.error ? (
                <div className={styles.errorBox} role="alert">
                  <span>{p.error}</span>
                  <button type="button" className={styles.iconBtn} onClick={() => dismiss(p.id)} aria-label={`Dismiss failed upload of ${p.name}`}>
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <span className={styles.spinner} aria-label={`Uploading ${p.name}`}>
                  <Loader2 size={18} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {room > 0 && (
        <div
          className={`${styles.dropzone} ${isDragging ? styles.dragging : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (!disabled) addFiles(e.dataTransfer.files);
          }}
        >
          <ImagePlus size={20} />
          <button type="button" className={styles.pick} onClick={() => inputRef.current?.click()} disabled={disabled}>
            Choose photos
          </button>
          <span className={styles.hint}>or drag them here. Phone photos are shrunk automatically.</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
};
