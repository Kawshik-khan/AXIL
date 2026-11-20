"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./Icons";
import { c } from "./classes";
import { PLANS, YEARLY_PREVIEW_DISCOUNT, taka } from "./plans";

/** What every plan includes. Only the staff-user limit differs between plans and is enforced (see plans.ts). */
const INCLUDED = ["Orders, stock and customers", "Shared inbox for every channel", "AI agents with your approval", "Analytics and audit trail"];

/** Popular plan, drawn dark. */
const HIGHLIGHT = "GROWTH";

export function Pricing() {
  const [yearly, setYearly] = useState(false);

  const price = (monthly: number) => (yearly ? Math.round(monthly * (1 - YEARLY_PREVIEW_DISCOUNT / 100)) : monthly);

  return (
    <section id="pricing" className={c("sec")}>
      <div className={c("wrap")}>
        <div className={c("head center")}>
          <span className={c("eyebrow")}><i />Pricing</span>
          <h2 className={c("h2")}>Plans that grow <span className={c("hl")}>with your shop.</span></h2>
          <p className={c("lede")}>Per workspace, per month, in taka. Every plan has every feature; only the team size changes.</p>
          <div className={c("billing")}>
            <span className={c(yearly ? "blbl" : "blbl on")}>Monthly</span>
            <button type="button" role="switch" aria-checked={yearly} aria-label="Show yearly prices" className={c(yearly ? "bsw on" : "bsw")} onClick={() => setYearly((y) => !y)}>
              <i />
            </button>
            <span className={c(yearly ? "blbl on" : "blbl")}>Yearly</span>
            <span className={c("chip lime")}>Save {YEARLY_PREVIEW_DISCOUNT}%</span>
          </div>
          <span className={c("muted small")}>
            {yearly ? "Yearly billing coming soon · preview prices" : "Early-access prices · may change"}
          </span>
        </div>

        <div className={c("pplans")}>
          {PLANS.map((plan) => {
            const dark = plan.id === HIGHLIGHT;
            const amount = price(plan.price);
            return (
              <div key={plan.id} className={c(dark ? "pcard dark" : "pcard")}>
                <div className={c("ptop")}>
                  <div className={c("row-between")}>
                    <h3>{plan.name}</h3>
                    {dark ? <span className={c("chip lime")}>Popular</span> : null}
                  </div>
                  <p>{plan.blurb}</p>
                  <div className={c("pprice")}>
                    <span className={c("num")}>{taka(amount)}</span>
                    <span className={c("per")}>/month</span>
                  </div>
                  <div className={c("pnote")}>
                    {plan.price === 0 ? "Free on both" : yearly ? `${taka(amount * 12)} a year · coming soon` : "Billed monthly"}
                  </div>
                  <Link className={c(dark ? "btn lime" : "btn ghost")} href="/register">
                    {plan.price === 0 ? "Start free" : `Choose ${plan.name}`}
                  </Link>
                </div>
                <ul className={c("pfeat")}>
                  <li><Icon.check size={16} /><b>Up to {plan.users} staff users</b></li>
                  {INCLUDED.map((item) => (
                    <li key={item}><Icon.check size={16} />{item}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
