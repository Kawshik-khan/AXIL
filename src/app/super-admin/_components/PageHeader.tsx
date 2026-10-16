import React from "react";
import { formatDateTime } from "../_lib/format";
import styles from "../super-admin.module.css";

/**
 * The header at the top of every console page: the page title, and the page's actions as frosted-glass buttons.
 * The description and the data timestamp are not shown, so the header stays a single line; they stay available to
 * screen readers and as a tooltip on the title.
 */
export const PageHeader: React.FC<{
  title: string;
  description: string;
  /** When the data on the page was produced by the API (from the response envelope). */
  fetchedAt?: string;
  actions?: React.ReactNode;
}> = ({ title, description, fetchedAt, actions }) => {
  const asOf = fetchedAt ? `As of ${formatDateTime(fetchedAt)} (Dhaka)` : "";
  return (
    <header className={styles.pageHeader}>
      <h1 className={styles.pageTitle} title={[description, asOf].filter(Boolean).join(" · ")}>
        {title}
        <span className={styles.visuallyHidden}>
          . {description} {asOf}
        </span>
      </h1>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  );
};
