import type { Metadata } from "next";

/** The sign-up page is a client component, so its tab title lives here. */
export const metadata: Metadata = {
  title: "Create your store · CommerceOS",
  description: "Create a CommerceOS store for your business.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
