import type { Metadata } from "next";
import "@/styles/tokens.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "CommerceOS — Agentic E-Commerce Automation Platform",
  description: "Unified, multi-tenant Agentic E-Commerce Automation Operating System for Bangladesh and conversational retail.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
