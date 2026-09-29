/**
 * A numeric setting from the environment. Unset, blank (`NAME=` copied from .env.example) or not a number gives the
 * default; a value below `min` is raised to `min`. `Number("")` is 0 and `Number("abc")` is NaN, which used to turn a
 * blank lease TTL into 5 s and a typo into a wait that never ends.
 */
export function envNumber(name: string, fallback: number, min = Number.NEGATIVE_INFINITY): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, value);
}
