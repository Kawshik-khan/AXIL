import styles from "./landing.module.css";

/**
 * Turns a space-separated list of class names into the CSS-module names, e.g. `c("panel black")`.
 * The landing's stylesheet keeps its plain class names (including dashed ones such as `on-black`), so the
 * markup reads like the stylesheet. An unknown name is skipped instead of rendering "undefined".
 */
export function c(names: string): string {
  return names
    .split(" ")
    .map((name) => (styles as Record<string, string>)[name])
    .filter(Boolean)
    .join(" ");
}
