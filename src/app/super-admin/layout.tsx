import React from "react";
import type { Metadata } from "next";
import styles from "./super-admin.module.css";

export const metadata: Metadata = {
  title: "CommerceOS — Platform Console",
  description: "Platform administration for CommerceOS: tenants, plans, AI governance, safety controls and audit.",
};

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.root}>{children}</div>;
}
