import { z } from "zod";
import { findSettingSpec, SETTINGS_REGISTRY, type SettingCategory } from "@/domains/platform/settings-registry";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";

/** Pure helpers for the Settings page: formatting, parsing and the filters. The server validates every change again. */

export type SettingFilter = "ALL" | "CHANGED" | "GOVERNED" | "LOCKED";

export const SETTING_CATEGORIES: readonly SettingCategory[] = [...new Set(SETTINGS_REGISTRY.map((s) => s.category))];

export function showValue(value: unknown, unit?: string): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null || value === undefined || value === "") return "Not set";
  const text = typeof value === "number" ? value.toLocaleString("en-US") : String(value);
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/** The value as form text. */
export function toInput(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Parses the form text into the type of the setting's default (number or boolean); strings are trimmed. */
export function parseInput(text: string, like: unknown): unknown {
  if (typeof like === "boolean") return text === "true";
  if (typeof like === "number") return text.trim() === "" ? NaN : Number(text);
  return text.trim();
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** HIGH and CRITICAL settings run through the two-person action (PlatformSettingsService.updateSetting). */
export function isGoverned(s: EffectiveSetting): boolean {
  return s.editable && (s.risk === "HIGH" || s.risk === "CRITICAL");
}

export function isChanged(s: EffectiveSetting): boolean {
  return s.source === "STORED" && !sameValue(s.value, s.default_value);
}

export function matchesFilter(s: EffectiveSetting, filter: SettingFilter): boolean {
  if (filter === "CHANGED") return isChanged(s);
  if (filter === "GOVERNED") return isGoverned(s);
  if (filter === "LOCKED") return !s.editable;
  return true;
}

export function matchesQuery(s: EffectiveSetting, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${s.label} ${s.key} ${s.description}`.toLowerCase().includes(q);
}

/** The allowed range from the setting's registry schema, e.g. "From 0 to 60."; null for a non-numeric setting. */
export function rangeText(key: string): string | null {
  const schema = findSettingSpec(key)?.schema;
  if (!(schema instanceof z.ZodNumber)) return null;
  const { minValue: min, maxValue: max } = schema;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const from = schema.safeParse(min).success ? `From ${min.toLocaleString("en-US")}` : `More than ${min.toLocaleString("en-US")}, up`;
  return `${from} to ${max.toLocaleString("en-US")}.`;
}

/** Long free text (bank details), which keeps its line breaks. */
export function isLongText(key: string): boolean {
  const schema = findSettingSpec(key)?.schema;
  return schema instanceof z.ZodString && (schema.maxLength ?? 0) > 200;
}

/** Why the registry schema refuses a value, or null when it is accepted. */
export function valueError(key: string, value: unknown): string | null {
  const schema = findSettingSpec(key)?.schema;
  if (!schema) return null; // an unregistered key is refused by the server
  const parsed = schema.safeParse(value);
  if (parsed.success) return null;
  const range = rangeText(key);
  if (!range) return parsed.error.issues[0]?.message ?? "This value is not allowed.";
  const whole = schema instanceof z.ZodNumber && schema.isInt;
  return `Enter a ${whole ? "whole " : ""}number. ${range}`;
}
