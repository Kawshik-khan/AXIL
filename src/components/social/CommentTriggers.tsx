"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MessageSquareReply, Plus, Pencil, Trash2, Power, RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { LoadingSkeleton, EmptyState, ErrorState, PermissionDenied } from "@/components/ui/States/States";
import type { CommentTriggerChannel, CommentTriggerEvent, CommentTriggerRule } from "@/types/social";
import styles from "./CommentTriggers.module.css";

const PLATFORM_LABEL: Record<CommentTriggerChannel, string> = { FACEBOOK_MESSENGER: "Facebook", INSTAGRAM: "Instagram" };
const STATUS_LABEL: Record<CommentTriggerEvent["status"], string> = {
  PENDING: "Queued",
  SENDING: "Sending",
  SENT: "Sent to inbox",
  FAILED: "Not sent",
  SKIPPED: "Skipped",
};
const MESSAGE_LIMIT = 1000;

interface FormState {
  name: string;
  keywords: string;
  channel_types: CommentTriggerChannel[];
  dm_message: string;
  post_ids: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { name: "", keywords: "", channel_types: ["FACEBOOK_MESSENGER", "INSTAGRAM"], dm_message: "", post_ids: "", is_active: true };

type LoadError = { message: string; requestId?: string; status?: number };

const splitList = (raw: string) => raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

async function readError(res: Response): Promise<LoadError> {
  const json = await res.json().catch(() => ({}));
  const issues: Array<{ path: string; message: string }> = json?.error?.details?.issues ?? [];
  const detail = issues.length ? ` ${issues.map((i) => `${i.path || "body"}: ${i.message}`).join("; ")}` : "";
  return { message: `${json?.error?.message || "Request failed."}${detail}`, requestId: json?.error?.request_id, status: res.status };
}

export function CommentTriggers() {
  const [rules, setRules] = useState<CommentTriggerRule[]>([]);
  const [events, setEvents] = useState<CommentTriggerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, eventsRes] = await Promise.all([
        fetch("/api/v1/social/comment-triggers"),
        fetch("/api/v1/social/comment-triggers/events?limit=50"),
      ]);
      if (!rulesRes.ok) return setError(await readError(rulesRes));
      if (!eventsRes.ok) return setError(await readError(eventsRes));
      setRules(((await rulesRes.json()).data?.triggers ?? []) as CommentTriggerRule[]);
      setEvents(((await eventsRes.json()).data?.events ?? []) as CommentTriggerEvent[]);
    } catch {
      setError({ message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (rule: CommentTriggerRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      keywords: rule.keywords.join(", "),
      channel_types: rule.channel_types,
      dm_message: rule.dm_message,
      post_ids: rule.post_ids.join(", "),
      is_active: rule.is_active,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const toggleChannel = (ch: CommentTriggerChannel) =>
    setForm((f) => ({
      ...f,
      channel_types: f.channel_types.includes(ch) ? f.channel_types.filter((c) => c !== ch) : [...f.channel_types, ch],
    }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = splitList(form.keywords);
    if (!form.name.trim() || keywords.length === 0 || !form.dm_message.trim() || form.channel_types.length === 0) {
      setFormError("Add a name, at least one keyword, a platform and the message to send.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name: form.name.trim(),
        keywords,
        channel_types: form.channel_types,
        dm_message: form.dm_message.trim(),
        post_ids: splitList(form.post_ids),
        is_active: form.is_active,
      };
      const res = await fetch(editingId ? `/api/v1/social/comment-triggers/${editingId}` : "/api/v1/social/comment-triggers", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await readError(res);
        setFormError(err.status === 403 ? "Your role can't change comment triggers." : err.message);
        return;
      }
      const saved = (await res.json()).data?.trigger as CommentTriggerRule;
      setRules((prev) => (editingId ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev]));
      setFormOpen(false);
    } catch {
      setFormError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (rule: CommentTriggerRule, isActive: boolean) => {
    setBusyId(rule.id);
    try {
      const res = await fetch(`/api/v1/social/comment-triggers/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: isActive }),
      });
      if (res.ok) {
        const saved = (await res.json()).data?.trigger as CommentTriggerRule;
        setRules((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      } else {
        setError(await readError(res));
      }
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (rule: CommentTriggerRule) => {
    if (!window.confirm(`Delete the trigger "${rule.name}"? Comments will no longer get this message.`)) return;
    setBusyId(rule.id);
    try {
      const res = await fetch(`/api/v1/social/comment-triggers/${rule.id}`, { method: "DELETE" });
      if (res.ok) setRules((prev) => prev.filter((r) => r.id !== rule.id));
      else setError(await readError(res));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="comment-triggers-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="comment-triggers-title" className={styles.sectionTitle}>
            <MessageSquareReply size={20} /> Comment → Inbox triggers
          </h2>
          <p className={styles.sectionSubtitle}>
            Choose keywords like &quot;price&quot; or &quot;দাম&quot;. When someone comments one on your Facebook or Instagram post,
            they get your offer in their inbox automatically: one message per comment.
          </p>
        </div>
        <div className={styles.ruleActions}>
          <button type="button" className={styles.ghostButton} onClick={load} disabled={loading} aria-label="Refresh triggers">
            <RefreshCw size={14} /> Refresh
          </button>
          {error?.status !== 403 && (
            <button type="button" className={styles.primaryButton} onClick={openNew}>
              <Plus size={14} /> New trigger
            </button>
          )}
        </div>
      </div>

      {formOpen && (
        <form className={styles.form} onSubmit={save} aria-label={editingId ? "Edit comment trigger" : "New comment trigger"}>
          <label className={styles.field}>
            Trigger name
            <input className={styles.input} value={form.name} maxLength={80} placeholder="Eid offer" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className={styles.field}>
            Keywords <span className={styles.hint}>Comma separated. Matches whole words, any case.</span>
            <input className={styles.input} value={form.keywords} placeholder="price, dam, দাম, offer" onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            Message sent to their inbox{" "}
            <span className={styles.hint}>
              Use {"{name}"} for the commenter&apos;s name and {"{keyword}"} for the word they used. {form.dm_message.length}/{MESSAGE_LIMIT}
            </span>
            <textarea
              className={styles.textarea}
              value={form.dm_message}
              maxLength={MESSAGE_LIMIT}
              placeholder="Hi {name}! Thanks for asking. This week only: 15% off with code EID15. Reply here to order."
              onChange={(e) => setForm({ ...form, dm_message: e.target.value })}
            />
          </label>
          <div className={styles.field}>
            Platforms
            <div className={styles.checkRow}>
              {(Object.keys(PLATFORM_LABEL) as CommentTriggerChannel[]).map((ch) => (
                <label key={ch}>
                  <input type="checkbox" checked={form.channel_types.includes(ch)} onChange={() => toggleChannel(ch)} /> {PLATFORM_LABEL[ch]}
                </label>
              ))}
              <label>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
              </label>
            </div>
          </div>
          <label className={styles.field}>
            Only these posts <span className={styles.hint}>Optional post ids, comma separated. Empty = all posts.</span>
            <input className={styles.input} value={form.post_ids} placeholder="All posts" onChange={(e) => setForm({ ...form, post_ids: e.target.value })} />
          </label>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <div className={styles.formActions}>
            <button type="button" className={styles.ghostButton} onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryButton} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create trigger"}
            </button>
          </div>
        </form>
      )}

      {loading && rules.length === 0 ? (
        <LoadingSkeleton lines={5} />
      ) : error?.status === 403 ? (
        <PermissionDenied resource="comment triggers" requiredPermission="social.template.read" inline />
      ) : error ? (
        <ErrorState message={error.message} requestId={error.requestId} onRetry={load} inline />
      ) : (
        <BentoGrid>
          <BentoCard span={7} title="Triggers" subtitle={`${rules.filter((r) => r.is_active).length} active of ${rules.length}`}>
            {rules.length === 0 ? (
              <EmptyState
                inline
                icon={<MessageSquareReply size={28} />}
                title="No comment triggers yet"
                description="Create one to send an offer to everyone who comments a keyword on your posts."
                actionText="New trigger"
                onAction={openNew}
              />
            ) : (
              <div className={styles.ruleList}>
                {rules.map((rule) => (
                  <article key={rule.id} className={`${styles.rule} ${rule.is_active ? "" : styles.ruleInactive}`}>
                    <div className={styles.ruleTop}>
                      <div>
                        <h3 className={styles.ruleName}>{rule.name}</h3>
                        <span className={styles.ruleMeta}>
                          {rule.channel_types.map((c) => PLATFORM_LABEL[c]).join(" + ")} ·{" "}
                          {rule.post_ids.length ? `${rule.post_ids.length} post(s)` : "All posts"} · {rule.is_active ? "Active" : "Paused"}
                        </span>
                      </div>
                      <div className={styles.ruleActions}>
                        <button type="button" className={styles.ghostButton} onClick={() => setActive(rule, !rule.is_active)} disabled={busyId === rule.id} aria-label={rule.is_active ? `Pause ${rule.name}` : `Activate ${rule.name}`}>
                          <Power size={14} /> {rule.is_active ? "Pause" : "Activate"}
                        </button>
                        <button type="button" className={styles.ghostButton} onClick={() => openEdit(rule)} disabled={busyId === rule.id} aria-label={`Edit ${rule.name}`}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className={styles.dangerButton} onClick={() => remove(rule)} disabled={busyId === rule.id} aria-label={`Delete ${rule.name}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className={styles.chips}>
                      {rule.keywords.map((k) => (
                        <span key={k} className={styles.chip}>{k}</span>
                      ))}
                    </div>
                    <p className={styles.offer}>{rule.dm_message}</p>
                  </article>
                ))}
              </div>
            )}
            <p className={styles.note}>
              Needs a Facebook Page or Instagram account connected with{" "}
              <a href="/connector/facebook">Connect with Facebook</a>. Meta allows one inbox reply per comment, within 7 days.
            </p>
          </BentoCard>

          <BentoCard span={5} title="Recent activity" subtitle="Matched comments and whether the offer reached the inbox">
            {events.length === 0 ? (
              <EmptyState inline title="Nothing yet" description="Matched comments will appear here with their delivery status." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Comment</th>
                      <th scope="col">Keyword</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td className={styles.comment}>
                          <strong>{ev.commenter_name || "Someone"}</strong> · {PLATFORM_LABEL[ev.channel_type]}
                          <span className={styles.reason}>&ldquo;{ev.comment_text}&rdquo;</span>
                          <span className={styles.reason}>{new Date(ev.created_at).toLocaleString()} · {ev.rule_name}</span>
                        </td>
                        <td>{ev.matched_keyword}</td>
                        <td>
                          <span className={`${styles.status} ${styles[`status${ev.status}`]}`}>{STATUS_LABEL[ev.status]}</span>
                          {ev.failure_reason && ev.status !== "SENT" && <span className={styles.reason}>{ev.failure_reason}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BentoCard>
        </BentoGrid>
      )}
    </section>
  );
}
