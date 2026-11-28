import { redirect } from "next/navigation";

/**
 * The Intelligence home moved into Analytics as its Recommendations tab (2026-11-26). Its revenue, order and AOV
 * cards repeated the Analytics cards. Old links and bookmarks land on the new tab.
 */
export default function IntelligenceHomeRedirect() {
  redirect("/analytics?tab=recommendations");
}
