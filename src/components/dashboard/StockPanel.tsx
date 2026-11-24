import React from "react";
import Link from "next/link";
import { PERMISSIONS } from "@/lib/permissions";
import { formatCount, type DashboardMetrics, type Section } from "./dashboard-data";
import { Panel } from "./Panel";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

/** Stock totals from inventory. */
export const StockPanel: React.FC<{ metrics: Section<{ metrics: DashboardMetrics }> }> = ({ metrics }) => (
  <Panel title="Stock" link={{ href: "/inventory", label: "Inventory" }}>
    <SectionState section={metrics} resource="stock totals" permission={PERMISSIONS.DASHBOARD_READ}>
      {({ metrics: m }) => {
        const boxes = [
          { label: "Units on hand", value: m.totalStockUnits, tone: styles.stockLilac },
          { label: "Low stock items", value: m.lowStockCount, tone: m.lowStockCount > 0 ? styles.stockWarn : "" },
          { label: "Products", value: m.totalProducts, tone: "" },
          { label: "Warehouses", value: m.warehousesCount, tone: "" },
        ];
        return (
          <>
            <div className={styles.stockGrid}>
              {boxes.map((box) => (
                <div key={box.label} className={`${styles.stockBox} ${box.tone}`}>
                  <span>{box.label}</span>
                  <strong>{formatCount(box.value)}</strong>
                </div>
              ))}
            </div>
            <Link href="/inventory" className={`${styles.linkPill} ${styles.linkWide}`}>
              Manage warehouses and transfers
            </Link>
          </>
        );
      }}
    </SectionState>
  </Panel>
);
