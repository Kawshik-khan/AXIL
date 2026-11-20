import Link from "next/link";
import { ROADMAP } from "./content";
import { Icon } from "./Icons";
import { c } from "./classes";

/** The static sections: features, workflow, analytics, founding merchants and the roadmap. */

export function Features() {
  return (
    <section id="features" className={c("sec")}>
      <div className={c("wrap")}>
        <span className={c("eyebrow")}><i />Features</span>
        <h2 className={c("h2 narrow")}>Not another inbox. <span className={c("hl")}>A whole back office.</span></h2>
        <p className={c("lede")}>Facebook pages are good at starting orders and bad at tracking them. CommerceOS is everything behind the chat.</p>

        <div className={c("bento")}>
          <article className={c("card span2 tall")}>
            <h3>Orders that can&apos;t go missing</h3>
            <p className={c("narrow-p")}>One lifecycle from first message to doorstep. Every status change is checked and written to the audit trail.</p>
            <div className={c("order-stack")} aria-hidden="true">
              <div className={c("glass row-between faded2")}><span>#CO-1039 · Delivered</span><span className={c("dot dot-gray")} /></div>
              <div className={c("glass row-between faded1")}><span>#CO-1041 · Shipped</span><span className={c("dot dot-ink")} /></div>
              <div className={c("glass")}>
                <div className={c("row-between strong")}><span>#CO-1042 · Confirmed</span><span>৳1,450</span></div>
                <div className={c("progress")}><i className={c("on")} /><i className={c("on")} /><i /><i /></div>
                <div className={c("meta")}>Approved by Sadia · 10:42</div>
              </div>
            </div>
          </article>

          <article className={c("card tall")}>
            <h3>One shared inbox</h3>
            <p>Telegram today in beta, more channels next. The customer&apos;s orders sit beside the chat.</p>
            <div className={c("mini-chat")} aria-hidden="true">
              <div className={c("bubble-in bn")}>Ei dress ta ki XL e pawa jabe?</div>
              <div className={c("bubble-lime")}>Yes, 4 left in XL. Shall I book it for you?</div>
              <div className={c("meta right")}>Drafted by support agent · sent by Arif</div>
            </div>
          </article>

          <article className={c("card")}>
            <h3>Stock that stays honest</h3>
            <p>Variants and stock movements live together, so the number you see is the number you can sell.</p>
            <div className={c("sizes")} aria-hidden="true">
              <div className={c("glass")}>S<b>18</b></div>
              <div className={c("glass")}>M<b>12</b></div>
              <div className={c("glass warn")}>L<b>3</b></div>
              <div className={c("glass")}>XL<b>4</b></div>
            </div>
          </article>

          <article className={c("card")}>
            <h3>Return risk, scored</h3>
            <p>Every cash-on-delivery order gets a risk score before you ship it.</p>
            <div className={c("risk")}>
              <div className={c("gauge")} role="img" aria-label="Example risk score 68 out of 100"><span>68</span></div>
              <div className={c("meta-lg")}><b>Medium risk</b><br />2 past returns. Ask for advance delivery fee.</div>
            </div>
          </article>

          <article className={c("card")}>
            <h3>Delivery zones you set</h3>
            <p>Inside Dhaka, suburbs, outside Dhaka. Fees come from your settings, never hard-coded.</p>
            <div className={c("zones")}>
              <div><span>Inside Dhaka</span><span className={c("muted")}>60 TK</span></div>
              <div><span>Dhaka suburbs</span><span className={c("muted")}>80 TK</span></div>
              <div><span>Outside Dhaka</span><span className={c("muted")}>120 TK</span></div>
              <span className={c("meta")}>Example fees · you set your own</span>
            </div>
          </article>

          <article className={c("card span3")}>
            <div className={c("two-col")}>
              <div>
                <h3>Cash on delivery, done right.</h3>
                <p>Cash on delivery is a first-class way to pay. bKash and SSLCommerz are being proven, and a payment will only count when the gateway confirms it.</p>
              </div>
              <div className={c("steps-stair")} aria-hidden="true">
                <div className={c("glass event")}><span className={c("ibox")}><Icon.bag size={18} /></span><div><b>COD order confirmed</b><span className={c("meta")}>#CO-1044 · ৳2,300 · Mirpur</span></div></div>
                <div className={c("glass event step1")}><span className={c("ibox lime")}><Icon.check size={18} /></span><div><b>Return risk checked: low</b><span className={c("meta")}>Approved by you, moved to packing</span></div></div>
                <div className={c("glass event step2")}><span className={c("ibox")}><Icon.clock size={18} /></span><div><b>bKash and SSLCommerz</b><span className={c("meta")}>Being proven · not live yet</span></div></div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: "chat", title: "Message", text: "A customer asks on Telegram today, more channels next." },
  { icon: "sparkle", title: "Order drafted", text: "The agent reads the chat, checks stock and drafts the order." },
  { icon: "check", title: "You approve", text: "One tap. Risky orders are flagged before they ship." },
  { icon: "box", title: "Packed", text: "Stock moves are recorded automatically." },
  { icon: "truck", title: "Shipped", text: "You hand it to your courier. In-app booking is planned." },
  { icon: "card", title: "Paid", text: "Cash on delivery is recorded against the order." },
] as const;

export function Workflow() {
  return (
    <section id="workflow" className={c("sec")}>
      <div className={c("wrap")}>
        <span className={c("eyebrow")}><i />How an order moves</span>
        <h2 className={c("h2")}>From <span className={c("hl bn")}>“price koto?”</span> to delivered.</h2>
        <p className={c("lede")}>One order, six steps. Agents handle the busywork in between; you approve the moments that cost money.</p>
        <ol className={c("steps")}>
          {STEPS.map((s, i) => {
            const Glyph = Icon[s.icon];
            return (
              <li key={s.title} className={c(i === 2 ? "card step key" : "card step")}>
                <span className={c(i === 2 ? "step-ic lime" : "step-ic")}><Glyph size={18} /></span>
                <span className={c("step-n")}>{String(i + 1).padStart(2, "0")}</span>
                <h4>{s.title}</h4>
                <p>{s.text}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

const BARS = [
  { label: "Web", h: 30 },
  { label: "WA", h: 44 },
  { label: "IG", h: 58 },
  { label: "FB", h: 74 },
  { label: "Total", h: 90 },
] as const;

export function Analytics() {
  return (
    <section id="analytics" className={c("sec")}>
      <div className={c("wrap")}>
        <span className={c("eyebrow")}><i />Marketing &amp; data analysis</span>
        <h2 className={c("h2 narrow")}>Know what sells. <span className={c("hl")}>Then sell more of it.</span></h2>
        <p className={c("lede")}>Analytics read every row, never a sample. When a number is unknown, you see a dash, not a guess.</p>
        <div className={c("analytics-grid")}>
          <article className={c("card chart-card")}>
            <div className={c("row-between top")}>
              <div>
                <h3>Revenue by channel</h3>
                <p className={c("narrow-p")}>See which page, post and channel actually brings paid orders, not just messages.</p>
              </div>
              <span className={c("chip")}>Sample data</span>
            </div>
            <div className={c("bars")} aria-hidden="true">
              {BARS.map((b) => (
                <div key={b.label} className={c("bar")} style={{ height: `${b.h}%` }}><span>{b.label}</span></div>
              ))}
            </div>
          </article>
          <div className={c("stack-col")}>
            <article className={c("card")}>
              <h3>Campaigns that pay back</h3>
              <p>The marketing agent drafts your Eid post in Bangla and English, then tracks the orders it brings in.</p>
              <div className={c("campaign")} aria-hidden="true">
                <span className={c("chip")}>Post</span>
                <span className={c("campaign-ic")}><Icon.megaphone size={44} /></span>
                <span className={c("chip")}>Orders</span>
              </div>
            </article>
            <article className={c("card")}>
              <h3>Customers, segmented</h3>
              <p>New, repeat and drifting-away buyers, so you know who to thank and who to win back.</p>
              <div className={c("segments")} aria-hidden="true">
                <i className={c("ring r1")} /><i className={c("ring r2")} /><i className={c("ring r3")} />
                <b className={c("seg s1")} /><b className={c("seg s2")} /><b className={c("seg s3")} /><b className={c("seg s4")} /><b className={c("seg s5")} />
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FoundingMerchants() {
  return (
    <section id="founding" className={c("sec")}>
      <div className={c("wrap")}>
        <div className={c("founding")}>
          <div>
            <span className={c("eyebrow")}><i />Founding merchants</span>
            <h2 className={c("h2")}>Be one of our <span className={c("hl")}>first 50 merchants.</span></h2>
            <p className={c("lede")}>We are in early access. Founding merchants shape what gets built next, and their words will go here.</p>
          </div>
          <ul className={c("perks")}>
            <li><Icon.check size={18} />Early access to every new agent</li>
            <li><Icon.check size={18} />A direct line to the team, in Bangla or English</li>
            <li><Icon.check size={18} />A say in what we build next</li>
            <li className={c("perk-cta")}><Link className={c("btn ink")} href="/register">Join as a founding merchant</Link></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function RoadList({ items, tone }: { items: readonly (readonly [string, string])[]; tone: "live" | "prov" | "plan" }) {
  return (
    <ul className={c("rlist")}>
      {items.map(([bold, rest]) => (
        <li key={bold}>
          <span className={c(`ri ${tone}`)} aria-hidden="true">{tone === "live" ? <Icon.check size={12} /> : null}</span>
          <span><b>{bold}</b>{rest.startsWith(":") ? rest : rest ? ` ${rest}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function Roadmap() {
  return (
    <section id="roadmap" className={c("sec")}>
      <div className={c("wrap")}>
        <div className={c("head center")}>
          <span className={c("eyebrow")}><i />Honest roadmap</span>
          <h2 className={c("h2")}>What works today, <span className={c("hl")}>and what comes next.</span></h2>
          <p className={c("lede")}>CommerceOS is early. Here is where each part stands, so you can decide what to rely on.</p>
        </div>
        <div className={c("rmap")}>
          <div className={c("rcol")}>
            <span className={c("rdot live")} aria-hidden="true" />
            <div className={c("rcard dark")}>
              <div className={c("rhead")}><span className={c("chip lime")}>Working today</span><span className={c("rcount")}>{ROADMAP.live.length} parts</span></div>
              <RoadList items={ROADMAP.live} tone="live" />
            </div>
          </div>
          <div className={c("rcol")}>
            <span className={c("rdot prov")} aria-hidden="true" />
            <div className={c("rcard")}>
              <div className={c("rhead")}><span className={c("chip dark")}>Being proven</span><span className={c("rcount")}>{ROADMAP.proving.length} parts</span></div>
              <RoadList items={ROADMAP.proving} tone="prov" />
            </div>
          </div>
          <div className={c("rcol")}>
            <span className={c("rdot plan")} aria-hidden="true" />
            <div className={c("rcard")}>
              <div className={c("rhead")}><span className={c("chip")}>Planned</span><span className={c("rcount")}>{ROADMAP.planned.length} parts</span></div>
              <RoadList items={ROADMAP.planned} tone="plan" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
