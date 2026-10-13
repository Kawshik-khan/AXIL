import type { Metadata } from "next";

/** The sign-in page is a client component, so its tab title lives here. */
export const metadata: Metadata = {
  title: "Sign in · CommerceOS",
  description: "Sign in to your CommerceOS store.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
