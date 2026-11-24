import React from "react";
import Link from "next/link";
import { PERMISSIONS } from "@/lib/permissions";
import type { AgentRun } from "@/types/ai";
import { readable, timeAgo, type Section } from "./dashboard-data";
import { Panel } from "./Panel";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

const SHOWN = 5;
const FINISHED: ReadonlyArray<AgentRun["status"]> = ["COMPLETED", "FAILED", "CANCELLED"];

/** A run a person has to take over or decide on. The approval flag stays on runs that already finished. */
const isWaiting = (run: AgentRun) =>
  run.status === "ESCALATED" ||
  run.status === "WAITING_HUMAN" || Boolean(run.requires_human_approval && !FINISHED.includes(run.status));

function statusClass(run: AgentRun): string {
  if (isWaiting(run)) return styles.statusWait;
  if (run.status === "COMPLETED") return styles.statusOk;
  return run.status === "FAILED" ? styles.statusBad : styles.statusIdle;
}

const summary = (run: AgentRun) => (run.final_response || run.error_message || `Step: ${readable(run.current_step)}`).slice(0, 110);

/** The latest recorded AI agent runs. */
export const AgentActivity: React.FC<{ runs: Section<AgentRun[]> }> = ({ runs }) => {
  const latest = [...(runs.data ?? [])].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")).slice(0, SHOWN);
  const waiting = latest.filter(isWaiting).length;
  const note = latest.length === 0 ? undefined : `Latest ${latest.length} runs${waiting > 0 ? `, ${waiting} need a person` : ""}`;

  return (
    <Panel title="✦ Agent activity" note={note} link={{ href: "/agents", label: "Logs" }}>
      <SectionState section={runs} resource="agent activity" permission={PERMISSIONS.AI_READ}>
        {() =>
          latest.length === 0 ? (
            <p className={styles.empty}>No agent runs recorded yet.</p>
          ) : (
            <div className={styles.runs}>
              {latest.map((run) => (
                <Link key={run.id} href="/agents" className={`${styles.run} ${isWaiting(run) ? styles.runWaiting : ""}`}>
                  <span className={styles.runTime}>{timeAgo(run.started_at)}</span>
                  <span className={styles.runText}>
                    <strong>{readable(run.agent_type)}</strong>
                    <span>{summary(run)}</span>
                  </span>
                  <span className={statusClass(run)}>{isWaiting(run) ? "Review" : readable(run.status)}</span>
                </Link>
              ))}
            </div>
          )
        }
      </SectionState>
    </Panel>
  );
};
