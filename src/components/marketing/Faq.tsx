"use client";

import { query } from "@lucasmarkes/hairline";
import { Figure } from "./Figure";
import { c } from "./classes";
import { PLANS, taka } from "./plans";

const PAID = PLANS.filter((plan) => plan.price > 0).map((plan) => plan.price);
const FROM = taka(Math.min(...PAID));
const TO = taka(Math.max(...PAID));

/** Straight answers. Each one is checked against .agent/STATUS.md, so nothing here promises what is not built. */
const QUESTIONS = [
  {
    q: "Is CommerceOS ready for real customers?",
    a: "Not yet. It is in early access. Orders, products, inventory, customers and access control work today, and the roadmap above says plainly which parts are still being proven.",
  },
  {
    q: "Which channels can I reply on?",
    a: "The shared inbox works with Telegram in beta. Sending on WhatsApp, Messenger and Instagram is planned, and until then the app reports a channel as not connected rather than pretending a message was sent.",
  },
  {
    q: "Can the AI send messages or change orders on its own?",
    a: "No. Agents read your data and draft work. Risky actions wait for a person's approval, and the customer chat agent starts in shadow mode, where it drafts replies for you to compare.",
  },
  {
    q: "Which AI provider does it use?",
    a: "You choose. Connect any OpenAI-compatible provider with your own keys. If none is configured, AI features say so instead of returning invented answers.",
  },
  {
    q: "Does it book couriers and verify bKash or Nagad payments?",
    a: "Not yet. Shipments are managed by hand today, and automatic courier booking and mobile-money verification are planned.",
  },
  {
    q: "What does it cost?",
    a: `Early-access plans start free, then run from ${FROM} to ${TO} a month per workspace, as listed above. These prices may change before general availability, and plan payments are not collected inside the app yet.`,
  },
] as const;

export function Faq() {
  return (
    <section className={c("panel line gridbg gmFaq")} id="faq">
      <div data-reveal className={c("two faq-wrap")}>
        <div>
          <span className={c("eyebrow")}>Questions</span>
          <h2>Straight answers.</h2>
          <div className={c("faq")}>
            {QUESTIONS.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
        <Figure
          mount={query}
          options={{ theme: "light", intensity: 0.6, play: true }}
          label="A question mark standing on a disc"
          className={c("fig on-white faq-fig")}
        />
      </div>
    </section>
  );
}
