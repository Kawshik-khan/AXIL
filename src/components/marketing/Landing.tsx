"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { basket, lockers, phone, plot, rebuild, terrain } from "@lucasmarkes/hairline";
import { channels, gate, lattice, pipeline, zones } from "./commerce-figures";
import { Faq } from "./Faq";
import { Figure } from "./Figure";
import { Pricing } from "./Pricing";
import { c } from "./classes";
import styles from "./landing.module.css";

/**
 * The public landing page. Every claim on it is checked against .agent/STATUS.md: what is built is described as
 * built, what is being proven or planned says so in the roadmap, and nothing here shows a made-up number.
 * Prices live in Pricing.tsx, the questions in Faq.tsx.
 */

const STAGES = ["Order placed", "Confirmed", "Packed", "Out for delivery", "Delivered"] as const;

const NAV = [
  { id: "product", label: "Product" },
  { id: "flow", label: "How it works" },
  { id: "bangladesh", label: "Bangladesh" },
  { id: "roadmap", label: "Roadmap" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
] as const;

function Arrow() {
  return (
    <svg className={c("arrow")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 18L18 6M8 6h10v10" />
    </svg>
  );
}

/**
 * Background for the overview: a block layout drawn in hairlines, tiled, behind the bento cards. One tile is
 * 410 × 520; only its top and left edges are drawn so neighbouring tiles share lines. Two blocks are tinted lime.
 */
function Blocks() {
  return (
    <svg className={c("blocks")} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="landing-blocks" width="410" height="520" patternUnits="userSpaceOnUse">
          <rect className={c("lit")} x="240" y="200" width="134" height="100" />
          <rect className={c("lit")} x="0" y="157" width="150" height="43" />
          <path d="M0 0H410M0 0V520M150 0V520M0 157H150M0 200H410M0 263H150M0 380H150M150 80H292M292 0V200M392 0V200M240 200V300M150 300H410M374 200V300M292 300V432M292 380H410M150 432H410" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#landing-blocks)" />
    </svg>
  );
}

function Tags({ items }: { items: readonly string[] }) {
  return (
    <ul className={c("tags")}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Tick({ title, children }: { title: string; children: string }) {
  return (
    <li>
      <div>
        <b>{title}</b>
        <span>{children}</span>
      </div>
    </li>
  );
}

export function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [light, setLight] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("");
  const [stage, setStage] = useState<string>(STAGES[0]);
  const root = useRef<HTMLDivElement>(null);

  // Once the page scrolls, a progressive blur fades in behind the nav. Its tint and the nav's text follow the section
  // underneath: a white haze with dark text over light sections, a dark haze with white text over dark ones.
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const under = Array.from(root.current?.querySelectorAll<HTMLElement>("main > *, footer") ?? []).find((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= 40 && r.bottom > 40;
      });
      setLight(!!under && !under.classList.contains(styles.black) && !under.classList.contains(styles.hero));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The mobile menu closes on Escape and when the screen grows past the phone layout.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const wide = window.matchMedia("(min-width: 861px)");
    const onWide = () => {
      if (wide.matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [menuOpen]);

  // Highlights the nav link of the section in the middle of the screen.
  useEffect(() => {
    const sections = NAV.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  // Sections and cards rise into place as they scroll into view. Without JS, or with reduced motion, everything
  // is simply shown: the hiding class is only added here.
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal], [data-draw]"));
    el.classList.add(styles.animate);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(styles.shown);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  // Smooth anchor scrolling for the nav, only on this page and not for people who ask for less motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const before = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => {
      root.style.scrollBehavior = before;
    };
  }, []);

  return (
    <div ref={root} className={`${c("landing")} ${scrolled ? styles.scrolled : ""} ${light && !menuOpen ? styles.navLight : ""} ${menuOpen ? styles.menuOpen : ""}`} id="top">
      <div className={c("topblur")} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <header className={c("nav")}>
        <a className={c("brand")} href="#top" onClick={() => setMenuOpen(false)}>
          <span className={c("logo")}>C✦</span> CommerceOS
        </a>
        <ul className={c("links")}>
          {NAV.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} aria-current={active === item.id ? "true" : undefined}>{item.label}</a>
            </li>
          ))}
        </ul>
        <div className={c("go")}>
          <Link className={c("btn line signin")} href="/login">Sign in</Link>
          <Link className={c("btn lime")} href="/register">Create your store</Link>
          <button
            type="button"
            className={c("burger")}
            aria-expanded={menuOpen}
            aria-controls="landing-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <i />
            <i />
          </button>
        </div>
        <nav id="landing-menu" className={c("menu")} aria-label="Sections" hidden={!menuOpen}>
          <ul>
            {NAV.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} onClick={() => setMenuOpen(false)}>{item.label}</a>
              </li>
            ))}
          </ul>
          <Link className={c("btn line")} href="/login">Sign in</Link>
        </nav>
      </header>

        <main className={c("main")}>
          {/* ---- hero ---- */}
          <section className={c("hero on-black")} id="hero">
            <div className={c("hero-grid")} aria-hidden="true" />
            <div className={c("hero-in")}>
              <div className={c("copy")}>
                <span className={c("badge")}><i /> Early access</span>
                <h1>Every order, parcel and chat in <mark>one calm place</mark></h1>
                <p className={c("lede")}>
                  CommerceOS gives Bangladeshi online sellers one control plane for orders, stock, customers and delivery. <strong>AI proposes, a person approves.</strong>
                </p>
                <div className={c("cta")}>
                  <Link className={c("btn lime")} href="/register">Create your workspace</Link>
                  <a className={c("btn line")} href="#overview">See what&apos;s inside</a>
                </div>
                <ul className={c("facts")}>
                  <li>Separate data for every store</li>
                  <li>Role-based access</li>
                  <li>Audit trail</li>
                  <li>Cash on delivery first</li>
                </ul>
              </div>
              <div className={c("fig-wrap")}>
                <Figure
                  mount={channels}
                  options={{ theme: "dark", intensity: 0.7, play: true, ambient: true }}
                  label="Messages from every channel streaming into one hub that turns them into orders"
                  className={c("fig")}
                />
              </div>
            </div>
          </section>

          {/* ---- overview grid ---- */}
          <div className={c("bento")} id="overview" data-draw>
            <Blocks />
            <article data-reveal className={c("card a")}>
              <Arrow />
              <h3>Orders and parcels</h3>
              <p className={c("sub")}>One lifecycle from first message to doorstep, written to an audit trail.</p>
              <Figure mount={basket} options={{ theme: "light", intensity: 0.55 }} label="An isometric shopping basket" className={c("fig on-card")} />
              <Tags items={["orders", "products", "variants", "inventory", "stock movements", "customers", "shipments", "returns"]} />
            </article>

            <article data-reveal className={c("card b")}>
              <Arrow />
              <h3>AI that asks first</h3>
              <Figure mount={gate} options={{ theme: "light", intensity: 0.6, play: true }} label="A barrier holding parcels until a person approves" className={c("fig on-card")} />
              <p className={c("sub")}>Nothing risky passes without a person.</p>
            </article>

            <article data-reveal className={c("card c")}>
              <Arrow />
              <h3>Shared inbox</h3>
              <Figure mount={phone} options={{ theme: "light", intensity: 0.55 }} label="A phone shown as exploded layers" className={c("fig on-card")} />
              <Tags items={["conversations", "customer history", "Telegram (beta)"]} />
            </article>

            <article data-reveal className={c("card black d on-black")}>
              <div className={c("copy")}>
                <h3 className={c("big")}>Stock that stays honest.</h3>
                <p className={c("lede")}>Products, variants and stock movements live together, so the number you see is the number you can sell.</p>
                <Tags items={["products", "variants", "stock movements", "low-stock alerts"]} />
              </div>
              <div className={c("fig-wrap")}>
                <Figure mount={lockers} options={{ theme: "dark", intensity: 0.55 }} label="A bank of lockers" className={c("fig")} />
              </div>
            </article>

            <article data-reveal className={c("card e")}>
              <Arrow />
              <h3>Every store is its own vault.</h3>
              <Tags items={["isolated data", "roles", "audit trail"]} />
            </article>
          </div>

          {/* ---- what you get ---- */}
          <section className={c("panel product")} id="product">
            <div data-reveal className={c("two")}>
              <div>
                <div className={c("pro")}><span className={c("logo")}>C✦</span> Early access</div>
                <h2>Run the back office. Skip the spreadsheets.</h2>
                <p className={c("lede")}>
                  Facebook pages and Instagram DMs are good at starting orders and bad at tracking them. CommerceOS is the back office behind them.
                  Every cell you see here stands for a record you can trust.
                </p>
                <div className={c("cols")}>
                  <div data-reveal className={c("mini")}><span className={c("n")}>01</span><h4>One source of truth for orders</h4><p>Every status change goes through a single order lifecycle, so a parcel can&apos;t be marked delivered by accident.</p></div>
                  <div data-reveal className={c("mini")}><span className={c("n")}>02</span><h4>Stock that stays honest</h4><p>Products, variants and stock movements live together, so the number you see is the number you can sell.</p></div>
                  <div data-reveal className={c("mini")}><span className={c("n")}>03</span><h4>Customers beside their chats</h4><p>See who is asking, what they bought and which orders are open, without switching apps.</p></div>
                </div>
              </div>
              <div className={c("cube-wrap gridbg gmCube")}>
                <Figure
                  mount={lattice}
                  options={{ theme: "light", intensity: 0.6, play: true }}
                  label="A cube made of grid cells, a few of them lit"
                  className={c("fig on-card figLattice")}
                />
              </div>
            </div>
          </section>

          {/* ---- how an order moves ---- */}
          <section className={c("panel black on-black gridbg gmFlow")} id="flow">
            <div data-reveal className={c("two")}>
              <div>
                <span className={c("eyebrow")}>How an order moves</span>
                <h2>From &quot;price koto?&quot; to delivered.</h2>
                <p className={c("lede")}>Follow one order along the belt, from first message to doorstep.</p>
                <ol className={c("stages")}>
                  {STAGES.map((name) => (
                    <li key={name} aria-current={name === stage ? "step" : undefined}>{name}</li>
                  ))}
                </ol>
                <p className={c("note")}>
                  One lifecycle service writes every order status and each change lands in the audit trail. Courier booking is manual today;
                  automatic booking is on the roadmap.
                </p>
              </div>
              <Figure
                mount={pipeline}
                options={{ theme: "dark", intensity: 0.5, play: true, onRead: setStage }}
                label="An order moving along a belt and becoming a delivered parcel"
                className={c("fig")}
              />
            </div>
          </section>

          {/* ---- Bangladesh ---- */}
          <section className={c("panel gridbg gmBangladesh")} id="bangladesh">
            <div data-reveal className={c("two")}>
              <Figure
                mount={zones}
                options={{ theme: "light", intensity: 0.6, play: true }}
                label="A grid of delivery zones around a warehouse"
                className={c("fig on-card figZones")}
              />
              <div>
                <span className={c("eyebrow")}>Made for Bangladesh</span>
                <h2>Built around how you actually sell.</h2>
                <p className={c("lede")}>
                  Most orders are cash on delivery, delivery depends on where the parcel goes, and customers write in Bangla, English and everything between.
                </p>
                <ul className={c("ticks")}>
                  <Tick title="Cash on delivery first">COD is a normal way to pay, not an afterthought.</Tick>
                  <Tick title="Delivery zones you control">Fees and thresholds come from your own settings. Nothing is hard-coded.</Tick>
                  <Tick title="Return risk, scored">Cash-on-delivery orders get a return-risk score. A first-time buyer starts from a neutral baseline and is marked as having no delivery history.</Tick>
                  <Tick title="Bangla and Banglish">The AI is built to read mixed-language messages and is tested on a replay set before it ships.</Tick>
                </ul>
              </div>
            </div>
          </section>

          {/* ---- AI and honest numbers ---- */}
          <div className={c("pair")}>
            <article data-reveal className={c("card white gridbg gmPairAi")}>
              <span className={c("eyebrow")}>AI with a safety catch</span>
              <h3>Agents draft. People decide.</h3>
              <ul className={c("ticks")}>
                <Tick title="Approvals tied to the exact order">Single-use, and checked again just before anything happens.</Tick>
                <Tick title="Every run is recorded">Model calls, tool calls and usage are logged with personal details trimmed.</Tick>
                <Tick title="Your model, your keys">Connect any OpenAI-compatible provider. With none configured, the AI says so instead of faking an answer.</Tick>
                <Tick title="Shadow mode first">The customer chat agent drafts replies for you to compare before it may speak for you.</Tick>
              </ul>
            </article>
            <article data-reveal className={c("card white gridbg gmPairNumbers")}>
              <span className={c("eyebrow")}>Honest numbers</span>
              <h3>When we don&apos;t know, we say <span className={c("dash")}>—</span></h3>
              <Figure mount={plot} options={{ theme: "light", intensity: 0.5 }} label="An isometric chart" className={c("fig on-card2 figPlot")} />
              <p className={c("sub wide")}>
                Analytics read every row, never a sample. Unknown values show as a dash. We don&apos;t fill gaps with made-up figures to make a chart look full.
              </p>
            </article>
          </div>

          {/* ---- roadmap ---- */}
          <section className={c("panel gridbg gmRoadmap")} id="roadmap">
            <div data-reveal className={c("two")}>
              <div>
                <span className={c("eyebrow")}>Honest roadmap</span>
                <h2>What works today, and what comes next.</h2>
                <p className={c("lede")}>CommerceOS is early. Here is where each part stands, so you can decide what to rely on.</p>
              </div>
              <Figure
                mount={rebuild}
                options={{ theme: "light", intensity: 0.55, play: true }}
                label="A tree with a solid top node and dashed branches growing below it"
                className={c("fig on-card figRoadmap")}
              />
            </div>
            <div className={c("road")}>
              <div data-reveal className={c("col live")}>
                <h3><i /> Working today</h3>
                <ul>
                  <li><b>Orders</b> with a single lifecycle and audit trail</li>
                  <li><b>Products, variants and inventory</b></li>
                  <li><b>Customers</b> and a shared inbox</li>
                  <li><b>Roles and permissions</b> on every route</li>
                  <li><b>Analytics</b> that never invent numbers</li>
                  <li><b>Platform controls</b>: kill switches, plan limits, read-only support sessions</li>
                </ul>
              </div>
              <div data-reveal className={c("col beta")}>
                <h3><i /> Being proven</h3>
                <ul>
                  <li><b>Telegram inbox</b>: built and tested, awaiting a live bot</li>
                  <li><b>AI agents</b> with approvals, read-only tasks so far</li>
                  <li><b>Customer chat agent</b>: shadow mode before any live use</li>
                  <li><b>Knowledge answers</b> with citations, still being measured</li>
                </ul>
              </div>
              <div data-reveal className={c("col next")}>
                <h3><i /> Planned</h3>
                <ul>
                  <li><b>Sending</b> on WhatsApp, Messenger and Instagram</li>
                  <li><b>Courier booking</b> from inside the app</li>
                  <li><b>bKash and Nagad</b> payment verification</li>
                  <li><b>Campaign sending</b> with frequency caps</li>
                </ul>
              </div>
            </div>
          </section>

          <Pricing />
          <Faq />

          {/* ---- closing call to action ---- */}
          <section className={c("panel black cta-panel gridbg on-black gmCta")}>
            <div data-reveal className={c("two")}>
              <div>
                <span className={c("eyebrow")}>Ready when you are</span>
                <h2>Give your store a calmer back office.</h2>
                <p className={c("lede")}>Create a workspace and look around. We would rather you see what works today than promise what doesn&apos;t yet.</p>
                <div className={c("row")}>
                  <Link className={c("btn lime")} href="/register">Create your workspace</Link>
                  <Link className={c("btn line")} href="/login">Sign in</Link>
                </div>
                <ul className={c("cta-facts")}>
                  <li>Free plan to start</li>
                  <li>Prices in taka</li>
                  <li>Early access</li>
                </ul>
              </div>
              <Figure
                mount={terrain}
                options={{ theme: "dark", intensity: 0.6, play: true }}
                label="A field of pillars that rise around the pointer"
                className={c("fig figTerrain limeHi")}
              />
            </div>
          </section>
        </main>

        <footer className={c("foot")}>
          <a className={c("brand")} href="#top"><span className={c("logo")}>C✦</span> CommerceOS</a>
          <span>Early access. Features and availability are described as they stand today.</span>
        </footer>
    </div>
  );
}
