"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/LogoMark";
import { AgentsHub } from "./AgentsHub";
import { Connectors } from "./Connectors";
import { EndCard } from "./EndCard";
import { Faq } from "./Faq";
import { HeroRoads } from "./HeroRoads";
import { Pricing } from "./Pricing";
import { Analytics, Features, FoundingMerchants, Roadmap, Workflow } from "./Sections";
import { c } from "./classes";

/**
 * The public landing page. Every claim on it is checked against .agent/STATUS.md: what is built is described as
 * built, what is being proven or planned says so, and nothing shows a made-up metric (demo numbers are labelled).
 * Interactive copy lives in content.ts, prices in plans.ts.
 */

const NAV = [
  { id: "agents", label: "Agents" },
  { id: "features", label: "Features" },
  { id: "connectors", label: "Connectors" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
] as const;

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

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
    <div className={c("landing")} id="top">
      <header className={c("nav-wrap")}>
        <nav className={c("nav")} aria-label="Main">
          <a className={c("brand-link")} href="#top" onClick={() => setMenuOpen(false)}>
            <LogoMark size={32} />
            CommerceOS
          </a>
          <ul className={c("links")}>
            {NAV.map((item) => (
              <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>
            ))}
          </ul>
          <div className={c("nav-go")}>
            <Link className={c("btn plain signin")} href="/login">Sign in</Link>
            <Link className={c("btn lime")} href="/register">Start free</Link>
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
        </nav>
        <nav id="landing-menu" className={c("menu")} aria-label="Sections" hidden={!menuOpen}>
          <ul>
            {NAV.map((item) => (
              <li key={item.id}><a href={`#${item.id}`} onClick={() => setMenuOpen(false)}>{item.label}</a></li>
            ))}
          </ul>
          <Link className={c("btn ghost")} href="/login">Sign in</Link>
        </nav>
      </header>

      <main>
        <HeroRoads />
        <AgentsHub />
        <Features />
        <Workflow />
        <Analytics />
        <Connectors />
        <FoundingMerchants />
        <Roadmap />
        <Pricing />
        <Faq />
        <EndCard />
      </main>
    </div>
  );
}
