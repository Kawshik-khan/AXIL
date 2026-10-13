import type { Metadata } from "next";
import { Landing } from "@/components/marketing/Landing";

export const metadata: Metadata = {
  title: "CommerceOS: one calm control plane for your store",
  description:
    "CommerceOS helps Bangladeshi online sellers run orders, stock, customers and delivery from one place, with AI that proposes and a person who approves.",
};

/** The public landing page. Visitors without a session see it at `/` as well (see src/proxy.ts). */
export default function WelcomePage() {
  return <Landing />;
}
