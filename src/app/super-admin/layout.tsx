import React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CommerceOS — SaaS Owner & Platform Control Plane",
  description: "Authoritative platform administration, multi-tenant governance, SaaS billing, and operational infrastructure control.",
};

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0f1013" }}>
      {children}
    </div>
  );
}
