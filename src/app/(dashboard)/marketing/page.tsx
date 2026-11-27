import { redirect } from "next/navigation";

/**
 * /marketing was merged into Growth (2026-11-26): its audiences live at /growth/audiences and its cart recovery at
 * /growth/cart-recovery; its broadcasts and attribution tabs were removed.
 */
export default function MarketingPage() {
  redirect("/growth");
}
