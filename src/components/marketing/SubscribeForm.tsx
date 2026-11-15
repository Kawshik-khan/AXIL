"use client";

import { useState, type FormEvent } from "react";
import { c } from "./classes";

/** The public newsletter endpoint. It stores the address and sends nothing; it answers the same for new and known emails. */
export const NEWSLETTER_ENDPOINT = "/api/v1/public/newsletter";

type State = { kind: "idle" | "sending" | "done" } | { kind: "error"; message: string };

export function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const res = await fetch(NEWSLETTER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), consent: true }),
      });
      if (res.ok) {
        setState({ kind: "done" });
        setEmail("");
        return;
      }
      const message =
        res.status === 429
          ? "Too many tries. Please wait a little and try again."
          : res.status === 400
            ? "Please enter a valid email address."
            : "Something went wrong. Please try again.";
      setState({ kind: "error", message });
    } catch {
      setState({ kind: "error", message: "You seem to be offline. Please try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <p className={c("sub-done")} role="status">
        Thanks, you&apos;re on the list. We&apos;ll write when there is news.
      </p>
    );
  }

  return (
    <>
      <form className={c("subbox")} onSubmit={submit} noValidate={false}>
        <label className={c("sr")} htmlFor="foot-email">Your email</label>
        <input
          id="foot-email"
          type="email"
          required
          placeholder="Enter your email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="foot-email-note"
        />
        <button type="submit" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Sending…" : "Subscribe"}
        </button>
      </form>
      {state.kind === "error" ? (
        <p className={c("sub-error")} role="alert">{state.message}</p>
      ) : null}
      <p id="foot-email-note" className={c("sub-note")}>
        By subscribing you agree to our <a href="#privacy">Privacy Policy</a> and to receive product updates. You can unsubscribe at any time.
      </p>
    </>
  );
}
