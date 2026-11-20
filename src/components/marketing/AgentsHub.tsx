"use client";

import { useState } from "react";
import { LogoMark } from "@/components/brand/LogoMark";
import { AGENTS, SCENARIOS, type AgentId } from "./content";
import { Icon, type IconName } from "./Icons";
import { c } from "./classes";

const AGENT_ICON: Record<AgentId, IconName> = {
  order: "bag",
  support: "chat",
  sales: "trend",
  social: "share",
  inventory: "box",
  delivery: "truck",
  payment: "card",
  marketing: "megaphone",
  analytics: "bars",
  product: "tag",
  finance: "taka",
  seo: "search",
};

/** Hub centre and the curve from it to each agent node (on the 740 × 600 fan). */
const HUB = { x: 110, y: 300 };
const curve = (x: number, y: number) => `M 170 ${HUB.y} C ${170 + (x - 170) * 0.45} ${HUB.y}, ${x - (x - 170) * 0.45} ${y}, ${x - 30} ${y}`;

export function AgentsHub() {
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[index];
  const lit = new Set<AgentId>(scenario.agents);

  return (
    <section id="agents" className={c("sec")}>
      <div className={c("wrap")}>
        <div className={c("head center")}>
          <span className={c("eyebrow")}><i />AI agents</span>
          <h2 className={c("h2")}>Twelve agents. <span className={c("hl")}>One hub.</span> You in charge.</h2>
          <p className={c("lede")}>
            Ask in Bangla, English or Banglish. The hub routes the job to the right agent. In early access, agents read your data and draft the
            work; nothing is sent or changed until you approve.
          </p>
        </div>

        <div className={c("agents-grid")}>
          {/* chat demo, styled like the CommerceOS inbox */}
          <div className={c("chat-col")}>
            <div className={c("chips")} role="group" aria-label="Try a chat">
              <span className={c("muted")}>Try a chat:</span>
              {SCENARIOS.map((s, i) => (
                <button key={s.id} type="button" className={c(i === index ? "sugg on" : "sugg")} aria-pressed={i === index} onClick={() => setIndex(i)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className={c("chat")}>
              <div className={c("chat-head")}>
                <span className={c("avatar")}>
                  {scenario.customer.initial}
                  <img className={c("avatar-badge")} src="/images/icons/channels/telegram.svg" alt="Telegram" width={16} height={16} />
                </span>
                <div className={c("grow")}>
                  <div className={c("chat-name")}>{scenario.customer.name}</div>
                  <div className={c("chat-via")}>via TELEGRAM · BETA</div>
                </div>
                <button type="button" className={c("resolve")}><Icon.check size={15} />Resolve</button>
              </div>
              <div className={c("chat-pills")}>
                <span className={c("chip small")}><span className={c("dot dot-green")} />Open</span>
                <span className={c("chip small")}>Support team</span>
              </div>
              <div className={c("chat-body")} aria-live="polite">
                <div className={c("bubble-in bn")}>{scenario.message}</div>
                <span className={c("time")}>07:17 PM</span>
                <div className={c("bubble-ai")}>
                  <span className={c("ai-badge")}><Icon.sparkle size={11} />AI draft · shadow mode</span>
                  <p className={c("bn")}>{scenario.draft}</p>
                </div>
                <span className={c("time right")}>Not sent · waiting for you</span>
              </div>
              <div className={c("chat-modes")}>
                <span className={c("mode on")}>Customer reply</span>
                <span className={c("mode")}>Internal note</span>
                <span className={c("mode")}>Quick replies</span>
                <span className={c("mode lime")}>AI suggest</span>
              </div>
              <div className={c("composer")}>
                <label className={c("sr")} htmlFor="chat-in">Reply to the customer</label>
                <input id="chat-in" type="text" placeholder="Type your reply in Bangla, English, or Banglish…" />
                <button type="button" className={c("send")}>Approve &amp; send<Icon.send size={15} /></button>
              </div>
            </div>
          </div>

          {/* hub and agents */}
          <div className={c("hub-col")}>
            <div className={c("fan")}>
              <svg className={c("fan-lines")} width="740" height="600" viewBox="0 0 740 600" fill="none" aria-hidden="true">
                <path d={`M -46 360 C 0 360, 10 300, 60 300`} className={c("link-base")} />
                <path d={`M -46 360 C 0 360, 10 300, 60 300`} className={c("link-flow")} />
                <circle cx="-46" cy="360" r="6" className={c("link-dot")} />
                {AGENTS.map((a) => (
                  <path key={a.id} d={curve(a.x, a.y)} className={c(lit.has(a.id) ? "link-flow" : "link-base")} />
                ))}
              </svg>
              <div className={c("hub")}>
                <LogoMark size={120} label="CommerceOS" />
              </div>
              {AGENTS.map((a) => {
                const Glyph = Icon[AGENT_ICON[a.id]];
                return (
                  <div key={a.id} className={c(lit.has(a.id) ? "agent on" : "agent")} style={{ left: a.x - 60, top: a.y - 26 }}>
                    <span className={c("agent-ic")}><Glyph size={22} /></span>
                    {a.name}
                  </div>
                );
              })}
            </div>

            <div className={c("answer")} aria-live="polite">
              <div className={c("answer-head")}>
                <strong>{scenario.card.title}</strong>
                <span className={c("chip")}>{scenario.card.agent}</span>
              </div>
              <p>{scenario.card.body}</p>
              <ul>
                {scenario.card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className={c("row")}>
                <button type="button" className={c("btn lime")}>{scenario.card.cta}</button>
                <button type="button" className={c("btn ghost")}>Review details</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
