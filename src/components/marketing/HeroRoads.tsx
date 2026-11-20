"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/brand/LogoMark";
import { Icon } from "./Icons";
import { c } from "./classes";
import { saveSignupEmail } from "./signup-handoff";

const ROAD_IN_TOP = "M -40 110 H 250 L 420 280 H 720";
const ROAD_IN_BOTTOM = "M -40 480 H 290 L 430 340 H 720";
const ROAD_OUT_MID = "M 720 340 H 1480";
const ROAD_OUT_TOP = "M 720 300 H 980 L 1110 170 H 1480";
const ROAD_OUT_BOTTOM = "M 720 380 H 960 L 1100 520 H 1480";

/** Agents travelling along the roads: path, duration, start offset and the puck's look. */
const TRAFFIC: readonly { path: string; dur: number; begin: number; tone: "lime" | "ink" | "white" }[] = [
  { path: ROAD_IN_TOP, dur: 9, begin: 0, tone: "lime" },
  { path: ROAD_IN_TOP, dur: 9, begin: -4.5, tone: "ink" },
  { path: ROAD_IN_BOTTOM, dur: 10, begin: -2, tone: "lime" },
  { path: ROAD_IN_BOTTOM, dur: 10, begin: -7, tone: "ink" },
  { path: ROAD_OUT_TOP, dur: 9, begin: -1, tone: "white" },
  { path: ROAD_OUT_TOP, dur: 9, begin: -5.5, tone: "white" },
  { path: ROAD_OUT_MID, dur: 8, begin: -3, tone: "lime" },
  { path: ROAD_OUT_BOTTOM, dur: 11, begin: -4, tone: "lime" },
];

const CHANNELS = [
  { name: "Facebook", icon: "/images/icons/channels/facebook.svg" },
  { name: "Instagram", icon: "/images/icons/channels/instagram.svg" },
  { name: "WhatsApp", icon: "/images/icons/channels/whatsapp.svg" },
] as const;

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduce;
}

function SignupEmail() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    saveSignupEmail(email);
    router.push("/register");
  }

  return (
    <form className={c("signup")} onSubmit={submit}>
      <label className={c("sr")} htmlFor="hero-email">Your email</label>
      <input
        id="hero-email"
        type="email"
        placeholder="Your email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" className={c("btn lime")}>Start free</button>
    </form>
  );
}

export function HeroRoads() {
  const reduce = usePrefersReducedMotion();

  return (
    <section id="top-hero" className={c("hero")}>
      <div className={c("wrap hero-copy")}>
        <span className={c("chip")}><span className={c("dot dot-lime")} />Early access · Made for Bangladesh</span>
        <h1 className={c("hero-h1")}>
          Every order, parcel and chat in <span className={c("hl")}>one calm place</span>
        </h1>
        <p className={c("hero-lede")}>
          Every order, chat and parcel meets in one hub. AI agents draft the work in between, and nothing happens until you approve it.
        </p>
        <SignupEmail />
      </div>

      <div className={c("roads")}>
        <svg
          viewBox="0 0 1440 620"
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label="Roads carry messages and orders from the left into the CommerceOS hub. On the right they leave as outcomes: approved by you, parcel ready to ship, or a risky cash-on-delivery order held for review."
        >
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44">
            <path d={ROAD_IN_TOP} className={c("road")} />
            <path d={ROAD_IN_BOTTOM} className={c("road")} />
            <path d={ROAD_OUT_MID} className={c("road")} />
            <path d={ROAD_OUT_TOP} className={c("road road-lime")} />
            <path d={ROAD_OUT_BOTTOM} className={c("road road-ink")} />
          </g>
          <g fill="none" strokeWidth="2" strokeDasharray="14 14" strokeLinecap="round" className={c(reduce ? "" : "lane")}>
            <path d={ROAD_IN_TOP} className={c("lane-light")} />
            <path d={ROAD_IN_BOTTOM} className={c("lane-light")} />
            <path d={ROAD_OUT_MID} className={c("lane-light")} />
            <path d={ROAD_OUT_TOP} className={c("lane-dark")} />
            <path d={ROAD_OUT_BOTTOM} className={c("lane-light")} />
          </g>

          <g className={c("road-label")}>
            <text transform="translate(352 172) rotate(45)" textAnchor="middle">message received</text>
            <text transform="translate(390 430) rotate(-45)" textAnchor="middle">order drafted</text>
            <text transform="translate(1070 262) rotate(-45)" textAnchor="middle" className={c("strong")}>approved by you</text>
            <text x="1290" y="318" textAnchor="middle">parcel ready to ship</text>
            <text transform="translate(1004 494) rotate(45)" textAnchor="middle" className={c("strong")}>risky COD held</text>
          </g>

          {!reduce &&
            TRAFFIC.map((t, i) => (
              <g key={i}>
                <animateMotion dur={`${t.dur}s`} repeatCount="indefinite" begin={`${t.begin}s`} path={t.path} />
                <circle r="9" className={c(`puck puck-${t.tone}`)} />
              </g>
            ))}

          {/* the CommerceOS tile stack, flat */}
          <rect x="606" y="216" width="228" height="228" rx="28" className={c("stack-plate")} />
          <rect x="726" y="228" width="96" height="96" rx="20" className={c("stack-tile")} />
          <rect x="618" y="336" width="96" height="96" rx="20" className={c("stack-tile")} />
          <rect x="726" y="336" width="96" height="96" rx="20" className={c("stack-ink")} />
          <path d="M 761 267 h 26 v 18 h -17 l -7 6 v -6 h -2 z" fill="none" className={c("stack-icon")} />
          <path d="M 653 378 l 13 -6 l 13 6 l -13 6 z M 653 378 v 14 l 13 6 l 13 -6 v -14 M 666 384 v 14" fill="none" className={c("stack-icon")} />
          <path d="M 762 384 l 8 8 l 16 -17" fill="none" className={c("stack-check")} />
          <foreignObject x="618" y="228" width="96" height="96">
            <LogoMark size={96} />
          </foreignObject>
        </svg>
      </div>

      <div className={c("wrap")}>
        <div className={c("channel-strip")}>
          <span className={c("inline")}>
            Channels: <img src="/images/icons/channels/telegram.svg" alt="" width={18} height={18} />
            <b>Telegram</b> in beta today, then
          </span>
          {CHANNELS.map((ch) => (
            <span key={ch.name} className={c("inline strong")}>
              <img src={ch.icon} alt="" width={18} height={18} />
              {ch.name}
            </span>
          ))}
          <span className={c("inline strong")}>
            <Icon.chat size={18} />
            Your website
          </span>
        </div>
      </div>
    </section>
  );
}
