import React, { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { PERMISSIONS } from "@/lib/permissions";
import { channelColor, paymentName, readable, type Currency, type DashboardMetrics, type Section } from "./dashboard-data";
import { Panel, Segmented } from "./Panel";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

type Filter = "all" | "unpaid" | "paid";
type RecentOrder = DashboardMetrics["recentOrders"][number];

interface RecentOrdersProps {
  metrics: Section<{ metrics: DashboardMetrics }>;
  currency: Currency;
  channel: string | null;
  onClearChannel: () => void;
}

const isPaid = (order: RecentOrder) => order.payment_status === "PAID";
/** The same meaning as the dashboard's unpaid count: not cancelled, and refunded, failed or authorized payments are neither. */
const isUnpaid = (order: RecentOrder) =>
  order.status !== "CANCELLED" && (order.payment_status === "PENDING" || order.payment_status === "UNPAID");

/** The five latest orders, filtered by payment here and by the channel chosen in Sales channels. */
export const RecentOrders: React.FC<RecentOrdersProps> = ({ metrics, currency, channel, onClearChannel }) => {
  const [filter, setFilter] = useState<Filter>("all");
  const reset = () => {
    setFilter("all");
    onClearChannel();
  };
  const note = channel ? (
    <button type="button" className={`${styles.chip} ${styles.chipButton}`} onClick={onClearChannel} aria-label={`Clear channel filter ${channel}`}>
      {channel} <X size={12} aria-hidden="true" />
    </button>
  ) : (
    "Your five latest orders"
  );

  return (
    <Panel
      title="Recent orders"
      note={note}
      link={{ href: "/orders", label: "All orders" }}
      actions={
        <Segmented<Filter>
          small
          label="Payment filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unpaid", label: "Unpaid" },
            { value: "paid", label: "Paid" },
          ]}
        />
      }
    >
      <SectionState section={metrics} resource="recent orders" permission={PERMISSIONS.DASHBOARD_READ}>
        {({ metrics: m }) => {
          if (m.recentOrders.length === 0) {
            return (
              <p className={styles.empty}>
                No orders yet.{" "}
                <Link href="/orders" className={styles.textButton}>
                  Create your first order
                </Link>
              </p>
            );
          }
          const rows = m.recentOrders.filter(
            (o) => (!channel || o.channel === channel) && (filter === "all" || (filter === "paid" ? isPaid(o) : isUnpaid(o))),
          );
          if (rows.length === 0) {
            return (
              <p className={styles.empty}>
                None of your latest orders match.{" "}
                <button type="button" className={styles.textButton} onClick={reset}>
                  Show all
                </button>
              </p>
            );
          }
          const channelIds = new Map(m.channelData.map((c) => [c.shortName, c.id]));
          return (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Channel</th>
                    <th scope="col" className={styles.right}>
                      Total
                    </th>
                    <th scope="col">Payment</th>
                    <th scope="col">Status</th>
                    <th scope="col">Courier</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href="/orders" className={styles.orderLink}>
                          {o.order_number}
                        </Link>
                      </td>
                      <td>
                        <span className={styles.cellMain}>{o.customer_name}</span>
                        <span className={styles.note}>
                          {o.shipping_address_snapshot?.district || o.shipping_address_snapshot?.division || "No district"},{" "}
                          {o.is_returning ? "repeat" : "new"}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellChannel}>
                          <span className={styles.swatch} style={{ background: channelColor(channelIds.get(o.channel)) }} />
                          {o.channel}
                        </span>
                      </td>
                      <td className={`${styles.right} ${styles.cellTotal}`}>{currency.format(o.grand_total ?? 0)}</td>
                      <td>
                        <span className={`${styles.chip} ${isPaid(o) ? styles.chipOk : styles.chipWarn}`}>
                          {paymentName(o.payment_method)}, {readable(o.payment_status).toLowerCase()}
                        </span>
                      </td>
                      <td>{readable(o.status)}</td>
                      <td className={styles.cellMuted}>{o.courier ? readable(o.courier) : "Not booked"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </SectionState>
    </Panel>
  );
};
