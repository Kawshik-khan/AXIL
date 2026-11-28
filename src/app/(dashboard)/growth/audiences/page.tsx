"use client";

import React, { useState } from "react";
import { Eye, Plus, RefreshCw } from "lucide-react";
import { useSection } from "@/components/dashboard/dashboard-data";
import { SectionState } from "@/components/dashboard/SectionState";
import { api } from "@/components/payments/api";
import { Modal } from "@/components/ui/Modal/Modal";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import { PERMISSIONS } from "@/lib/permissions";
import type { Audience } from "@/types/growth";
import { FeedbackToast, GrowthShell, Panel, type Feedback } from "../_components/GrowthShell";
import { describeCondition, formatBdt, initials, timeAgo, type RuleCondition } from "../_components/growth-format";
import styles from "../_components/Growth.module.css";

/**
 * Starting points a shop can save in one click. Each carries its own rule in fields audience.service evaluates (FX-36 M6);
 * the size is counted from the shop's customers when it is created, never shown in advance.
 */
const STARTERS: Array<{ name: string; description: string; conditions: RuleCondition[] }> = [
  {
    name: "VIP High Spenders",
    description: "Spent over ৳5,000 across 3 or more orders",
    conditions: [
      { field: "total_spend", operator: "GREATER_THAN", value: 5000 },
      { field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 3 },
    ],
  },
  {
    name: "Dormant 60D Customers",
    description: "No order in the last 60 days",
    conditions: [{ field: "last_purchase_days_ago", operator: "GREATER_THAN_OR_EQUAL", value: 60 }],
  },
  {
    name: "Abandoned Carts",
    description: "Left a cart without checking out",
    conditions: [{ field: "has_abandoned_cart", operator: "EQUALS", value: true }],
  },
  {
    name: "At-risk Customers",
    description: "High chance of not ordering again",
    conditions: [{ field: "churn_risk_level", operator: "EQUALS", value: "HIGH" }],
  },
];

interface Member {
  id: string;
  name: string;
  phone: string;
  total_spend_bdt: number;
  order_count: number;
  last_purchase_days_ago: number;
}

type MembersView =
  | { state: "loading"; audience: Audience }
  | { state: "error"; audience: Audience; message: string; requestId?: string }
  | { state: "ready"; audience: Audience; members: Member[] };

/** Saved customer groups: one Audiences page and API since the Marketing page's copy was merged in (2026-11-26). */
export default function AudiencesPage() {
  const list = useSection<{ audiences: Audience[] }>("/api/v1/growth/audiences");
  const [creating, setCreating] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [members, setMembers] = useState<MembersView | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const audiences = list.data?.audiences ?? [];
  const remaining = STARTERS.filter((s) => !audiences.some((a) => a.name === s.name));
  const largest = Math.max(...audiences.map((a) => a.estimated_size ?? 0), 1);

  const create = async (starter: (typeof STARTERS)[number]) => {
    setCreating(starter.name);
    setFeedback(null);
    const res = await api<{ audience: Audience }>("/api/v1/growth/audiences", {
      method: "POST",
      json: {
        name: starter.name,
        description: starter.description,
        type: "DYNAMIC",
        rule_groups: [{ conjunction: "AND", conditions: starter.conditions }],
      },
    });
    setCreating(null);
    if (res.ok) {
      setPickerOpen(false);
      setFeedback({ tone: "ok", text: `“${starter.name}” saved.` });
      list.reload();
    } else {
      setFeedback({ tone: "error", text: res.error?.message ?? "Couldn't save the audience." });
    }
  };

  const refresh = async (audience: Audience) => {
    setRefreshingId(audience.id);
    const res = await api(`/api/v1/growth/audiences/${audience.id}/refresh`, { method: "POST" });
    setRefreshingId(null);
    if (res.ok) list.reload();
    else setFeedback({ tone: "error", text: res.error?.message ?? "Couldn't recount the audience." });
  };

  const openMembers = async (audience: Audience) => {
    setMembers({ state: "loading", audience });
    const res = await api<{ members: Member[] }>(`/api/v1/growth/audiences/${audience.id}/members`);
    if (res.ok) setMembers({ state: "ready", audience, members: res.data?.members ?? [] });
    else setMembers({ state: "error", audience, message: res.error?.message ?? "Couldn't load members.", requestId: res.error?.request_id });
  };

  return (
    <GrowthShell
      active="/growth/audiences"
      title="Audiences"
      subtitle="Groups of customers built from what they spend, how often they order and when they last bought."
      counts={{ "/growth/audiences": list.data ? audiences.length : null }}
      actions={
        <>
          <button type="button" className={styles.ghost} onClick={list.reload} disabled={list.loading}>
            <RefreshCw size={14} className={list.loading ? styles.spin : undefined} /> Refresh
          </button>
          <button type="button" className={styles.primary} onClick={() => setPickerOpen(true)} disabled={remaining.length === 0}>
            <Plus size={16} /> New audience
          </button>
        </>
      }
    >
      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />

      <SectionState section={list} resource="audiences" permission={PERMISSIONS.MARKETING_READ}>
        {() =>
          audiences.length === 0 ? (
            <div className={styles.card}>
              <EmptyState
                inline
                title="No audiences yet"
                description="Save a group of customers to see who they are and how many there are. Start from one below."
              />
            </div>
          ) : (
            <section className={styles.segmentGrid} aria-label="Saved audiences">
              {audiences.map((a) => (
                <SegmentCard
                  key={a.id}
                  audience={a}
                  share={(a.estimated_size ?? 0) / largest}
                  refreshing={refreshingId === a.id}
                  onRefresh={() => void refresh(a)}
                  onMembers={() => void openMembers(a)}
                />
              ))}
            </section>
          )
        }
      </SectionState>

      {list.data && remaining.length > 0 && (
        <Panel lilac title="Start from a common audience" note="One click saves it; its size is counted from your customers.">
          <StarterGrid starters={remaining} creating={creating} onCreate={(s) => void create(s)} />
        </Panel>
      )}

      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="New audience">
        <p className={styles.note} style={{ marginBottom: "var(--space-12)" }}>
          Pick a starting point. Custom rules are not available here yet.
        </p>
        <StarterGrid starters={remaining} creating={creating} onCreate={(s) => void create(s)} stacked />
      </Modal>

      <Modal isOpen={members !== null} onClose={() => setMembers(null)} title={members ? `${members.audience.name}` : ""}>
        {members?.state === "loading" && <LoadingSkeleton lines={5} inline />}
        {members?.state === "error" && (
          <ErrorState inline message={members.message} requestId={members.requestId} onRetry={() => void openMembers(members.audience)} />
        )}
        {members?.state === "ready" &&
          (members.members.length === 0 ? (
            <p className={styles.empty}>No customers match this audience right now.</p>
          ) : (
            <>
              <p className={styles.note} style={{ marginBottom: "var(--space-12)" }}>
                {members.members.length.toLocaleString()} customers match today.
              </p>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className={styles.table} style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className={styles.right}>Spent</th>
                      <th className={styles.right}>Orders</th>
                      <th className={styles.right}>Last order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.members.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <span className={styles.person}>
                            <span className={styles.avatar} aria-hidden>
                              {initials(m.name)}
                            </span>
                            <span>
                              <span className={styles.cellMain}>{m.name}</span>
                              <span className={styles.cellMuted}>{m.phone}</span>
                            </span>
                          </span>
                        </td>
                        <td className={`${styles.right} ${styles.cellTotal}`}>{formatBdt(m.total_spend_bdt)}</td>
                        <td className={styles.right}>{m.order_count}</td>
                        <td className={styles.right}>{m.last_purchase_days_ago >= 999 ? "Never" : `${m.last_purchase_days_ago}d ago`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ))}
      </Modal>
    </GrowthShell>
  );
}

interface SegmentCardProps {
  audience: Audience;
  /** Size relative to the largest audience, 0–1 */
  share: number;
  refreshing: boolean;
  onRefresh: () => void;
  onMembers: () => void;
}

function SegmentCard({ audience, share, refreshing, onRefresh, onMembers }: SegmentCardProps) {
  const groups = audience.rule_groups ?? [];
  return (
    <article className={`${styles.card} ${styles.segment}`}>
      <div className={styles.segmentHead}>
        <div style={{ minWidth: 0 }}>
          <h2 className={styles.segmentName}>{audience.name}</h2>
          {audience.description && <p className={styles.note}>{audience.description}</p>}
        </div>
        <span className={`${styles.chip} ${styles.chipLilac}`}>{audience.type.toLowerCase()}</span>
      </div>

      <div>
        <div className={styles.segmentSize}>
          <strong>{(audience.estimated_size ?? 0).toLocaleString()}</strong>
          <span className={styles.note}>customers</span>
        </div>
        <div className={styles.track} aria-hidden style={{ marginTop: "var(--space-8)" }}>
          <span className={styles.trackFill} style={{ width: `${Math.max(2, share * 100)}%`, display: "block" }} />
        </div>
      </div>

      {groups.length > 0 && (
        <div className={styles.ruleChips} aria-label="Rules">
          {groups.map((g, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <span className={styles.ruleJoin}>and</span>}
              {g.conditions.map((c, ci) => (
                <React.Fragment key={ci}>
                  {ci > 0 && <span className={styles.ruleJoin}>{g.conjunction === "OR" ? "or" : "and"}</span>}
                  <span className={styles.chip}>{describeCondition(c as RuleCondition)}</span>
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className={styles.segmentFoot}>
        <span className={styles.note}>Counted {timeAgo(audience.last_evaluated_at)}</span>
        <span className={styles.segmentActions}>
          <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={onRefresh} disabled={refreshing} aria-label={`Recount ${audience.name}`}>
            <RefreshCw size={12} className={refreshing ? styles.spin : undefined} />
          </button>
          <button type="button" className={`${styles.primary} ${styles.small}`} onClick={onMembers}>
            <Eye size={13} /> Members
          </button>
        </span>
      </div>
    </article>
  );
}

interface StarterGridProps {
  starters: typeof STARTERS;
  creating: string | null;
  onCreate: (starter: (typeof STARTERS)[number]) => void;
  /** One column, for the modal */
  stacked?: boolean;
}

function StarterGrid({ starters, creating, onCreate, stacked = false }: StarterGridProps) {
  if (starters.length === 0) return <p className={styles.note}>You've saved every starting point.</p>;
  return (
    <div className={`${styles.starterGrid} ${stacked ? styles.starterStacked : ""}`}>
      {starters.map((s) => (
        <button key={s.name} type="button" className={styles.starter} onClick={() => onCreate(s)} disabled={creating !== null}>
          <strong>{s.name}</strong>
          <span>{s.description}</span>
          <span className={styles.starterAdd}>
            <Plus size={12} /> {creating === s.name ? "Saving…" : "Save audience"}
          </span>
        </button>
      ))}
    </div>
  );
}
