"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { c } from "./classes";
import { IsoGrid } from "./IsoGrid";
import { PLANS, taka } from "./plans";

const INCLUDED = ["Orders, products and inventory", "Customers and shared inbox", "Roles and audit trail"];

export function Pricing() {
  const section = useRef<HTMLElement>(null);
  const plans = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sec = section.current;
    if (!sec) return;

    // Each card glows where the pointer is (the grid behind them reacts on its own, see IsoGrid).
    const cards = Array.from(sec.querySelectorAll<HTMLElement>("[data-plan]"));
    const cardMoves = cards.map((card) => {
      const handler = (e: PointerEvent) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--cx", `${e.clientX - r.left}px`);
        card.style.setProperty("--cy", `${e.clientY - r.top}px`);
      };
      card.addEventListener("pointermove", handler);
      return { card, handler };
    });

    // The prices count up once when they scroll into view. The real numbers are already in the page.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let observer: IntersectionObserver | null = null;
    if (!reduce && plans.current && "IntersectionObserver" in window) {
      const nums = Array.from(sec.querySelectorAll<HTMLElement>("[data-price]"));
      observer = new IntersectionObserver(
        (entries, io) => {
          if (!entries.some((en) => en.isIntersecting)) return;
          io.disconnect();
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / 1000);
            const k = 1 - Math.pow(1 - p, 3);
            for (const el of nums) el.textContent = taka(Number(el.dataset.price) * (p < 1 ? k : 1));
            if (p < 1) frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
        },
        { threshold: 0.35 },
      );
      observer.observe(plans.current);
    }

    return () => {
      for (const { card, handler } of cardMoves) card.removeEventListener("pointermove", handler);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={section} className={c("panel black pricing")} id="pricing">
      <IsoGrid />
      <div data-reveal className={c("pricing-head")}>
        <span className={c("eyebrow")}>Pricing</span>
        <h2>Simple plans, in taka.</h2>
        <p className={c("lede")}>Early-access prices, per workspace and per month. They may change before general availability.</p>
      </div>
      <div ref={plans} className={c("plans")}>
        {PLANS.map((plan) => (
          <article key={plan.name} data-plan data-reveal className={c("plan")}>
            <h3>{plan.name}</h3>
            <div className={c("price")}>
              <b data-price={plan.price} aria-label={taka(plan.price)}>{taka(plan.price)}</b>
              <span>/ month</span>
            </div>
            <p className={c("blurb")}>{plan.blurb}</p>
            <ul>
              <li>
                <span>
                  <b>{plan.users}</b> staff users
                </span>
              </li>
              {INCLUDED.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link className={c(`btn ${plan.cta}`)} href="/register">
              Get started
            </Link>
          </article>
        ))}
      </div>
      <p className={c("fine")}>
        Every plan includes the same core features. The difference today is the number of staff users. Plan payments are not collected inside the
        app yet. Larger organisations with custom needs: custom plans are still being worked out.
      </p>
    </section>
  );
}
