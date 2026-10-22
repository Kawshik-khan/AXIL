/** Uploaded media (ADR-120). The file lives in object storage; this record is what the store keeps about it. */

import type { ImageMime } from "@/domains/media/image-bytes";

export type MediaPurpose = "PRODUCT_IMAGE";
export type MediaStorageKind = "s3" | "r2" | "local";

export interface MediaAsset {
  id: string;
  tenant_id: string;
  purpose: MediaPurpose;
  storage: MediaStorageKind;
  /** Object key, always under `tenants/<tenant_id>/`. */
  key: string;
  /** Where the image is served from: the public bucket URL (r2) or the authenticated dev route (local). */
  url: string;
  content_type: ImageMime;
  bytes: number;
  width: number;
  height: number;
  /** Of the stored bytes (metadata removed); one asset per image per tenant. */
  sha256: string;
  created_by: string;
  created_at: string;
}
