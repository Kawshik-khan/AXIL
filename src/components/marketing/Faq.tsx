import { Icon } from "./Icons";
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
    a: `Early-access plans start free, then run from ${FROM} to ${TO} a month per workspace, as listed above. Yearly billing is a preview and not on sale yet. These prices may change before general availability, and plan payments are not collected inside the app yet.`,
  },
] as const;

export function Faq() {
  return (
    <section id="faq" className={c("sec")}>
      <div className={c("wrap")}>
        <div className={c("faq-grid")}>
          <div>
            <span className={c("eyebrow")}><i />Questions</span>
            <h2 className={c("h2")}>Straight <span className={c("hl")}>answers.</span></h2>
            <p className={c("lede")}>Every answer is checked against what is actually built, so nothing here promises more than the product does.</p>
            <div className={c("ask-card")}>
              <span className={c("ask-ic")}><Icon.chat size={20} /></span>
              <h3>Still have a question?</h3>
              <p>Ask us in Bangla or English. A person replies, not a bot.</p>
              <a className={c("btn lime")} href="#contact">Write to us</a>
            </div>
          </div>
          <div className={c("faq")}>
            {QUESTIONS.map((item, i) => (
              <details key={item.q} open={i === 0}>
                <summary>
                  <span>{item.q}</span>
                  <span className={c("pm")} aria-hidden="true"><Icon.plus size={14} /></span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
