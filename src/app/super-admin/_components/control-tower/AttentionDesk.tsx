"use client";

import React, { useEffect, useState } from "react";
import { BentoCard } from "@/components/bento/BentoCard";
import type { AttentionItem, AttentionSeverity } from "@/domains/platform/services/platform-attention.service";
import { humanize } from "../../_lib/format";
import type { ResourceState } from "../../_lib/use-platform-resource";
import { ResourceView } from "../ResourceView";
import { AttentionInspector } from "./AttentionInspector";
import { CategoryIcon } from "./CategoryIcon";
import { ageLabel, categoryLabel, countBySeverity, SEVERITIES } from "./control-tower-view";
import { SeverityTag } from "./SeverityMark";
import styles from "./control-tower.module.css";

type Filter = "ALL" | AttentionSeverity;

/** True when the cards and the detail no longer fit side by side; the detail then opens under its card. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function Desk({ items, asOf }: { items: readonly AttentionItem[]; asOf: string }) {
  const narrow = useNarrow();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = countBySeverity(items);
  // A refresh can clear the filtered severity; the list then shows everything rather than nothing
  const active: Filter = filter !== "ALL" && counts[filter] === 0 ? "ALL" : filter;
  const visible = items.filter((i) => active === "ALL" || i.severity === active);
  const picked = visible.find((i) => i.id === selectedId);
  const selected = picked ?? (narrow ? undefined : visible[0]);

  return (
    <>
      <div className={styles.deskHead}>
        <h2>
          Needs attention <span>({items.length})</span>
        </h2>
        <div className={styles.pills} role="group" aria-label="Filter by severity">
          {(["ALL", ...SEVERITIES] as const)
            .filter((f) => f === "ALL" || counts[f] > 0)
            .map((f) => (
              <button key={f} type="button" aria-pressed={active === f} onClick={() => setFilter(f)}>
                {f === "ALL" ? "All" : humanize(f)} {f === "ALL" ? items.length : counts[f]}
              </button>
            ))}
        </div>
      </div>
      <ul className={styles.deck}>
        {visible.map((item) => {
          const isSelected = item.id === selected?.id;
          return (
            <React.Fragment key={item.id}>
              <li>
                <button
                  type="button"
                  className={styles.itemCard}
                  aria-current={!narrow && isSelected ? "true" : undefined}
                  aria-expanded={narrow ? isSelected : undefined}
                  onClick={() => setSelectedId(narrow && isSelected ? null : item.id)}
                >
                  <span className={styles.itemHead}>
                    <span className={item.id === items[0].id ? styles.iconTileLead : styles.iconTile}>
                      <CategoryIcon category={item.category} />
                    </span>
                    <span className={styles.itemTitle}>{item.title}</span>
                  </span>
                  <span className={styles.itemFoot}>
                    <SeverityTag severity={item.severity} />
                    <span className={`${styles.tag} ${styles.tagNeutral}`}>{categoryLabel(item)}</span>
                    {item.id === items[0].id && <span className={styles.next}>Next up</span>}
                    <span className={styles.itemAge}>{ageLabel(item)}</span>
                  </span>
                </button>
              </li>
              {narrow && isSelected && (
                <li className={styles.deckDetail}>
                  <AttentionInspector item={item} asOf={asOf} />
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ul>
      {!narrow && selected && (
        <aside className={styles.detail} aria-label="Selected item">
          <AttentionInspector key={selected.id} item={selected} asOf={asOf} />
        </aside>
      )}
    </>
  );
}

/** The inbox: severity filters, a card per item, and the detail of the selected one. */
export const AttentionDesk: React.FC<{ state: ResourceState<AttentionItem[]>; onRetry: () => void }> = ({ state, onRetry }) =>
  state.kind === "ready" ? (
    <section className={styles.desk} aria-label="Needs attention">
      <Desk items={state.data} asOf={state.fetchedAt} />
    </section>
  ) : (
    <BentoCard span={9} className={`${styles.card} ${styles.deskState}`} title="Needs attention">
      <ResourceView
        state={state}
        onRetry={onRetry}
        resource="the attention list"
        emptyFigure="all-clear"
        emptyTitle="Nothing needs attention"
        emptyDescription="No limits near capacity, incidents, kill switches, pending approvals, late handovers or MFA gaps right now."
        skeletonLines={6}
        renderReady={() => null}
      />
    </BentoCard>
  );
