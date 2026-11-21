"use client";

import { useState } from "react";
import { ISO_BEAM_CUTS, ISO_FACES, ISO_GRADIENTS } from "./storyArt";
import styles from "./story.module.css";

/**
 * The right-hand panel of the sign-in page: an isometric structure (storyArt.ts) over soft lime glows and film grain,
 * and a three-slide carousel that says what CommerceOS does. Every claim here is a capability STATUS.md lists as built;
 * nothing is a metric. The illustration is decorative and hidden from screen readers; the slide text is announced
 * politely when it changes. The arrows sit in a notch cut out of the panel's bottom-right corner.
 */

const SLIDES = [
  { eyebrow: "One inbox", headline: "Every customer message lands in one inbox, with the order and the stock right beside it." },
  { eyebrow: "You stay in charge", headline: "Agents draft the reply and the order. Nothing reaches a customer until you approve it." },
  { eyebrow: "Built for Bangladesh", headline: "Made around cash on delivery, bKash and the way Bangladeshi shops actually sell." },
] as const;

const tokenColor = (token: string) => `var(${token})`;

function IsoArt() {
  return (
    <svg className={styles.art} viewBox="0 0 700 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(ISO_GRADIENTS).map(([id, g]) => (
          <linearGradient key={id} id={`auth-iso-${id}`} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {g.stops.map(([offset, token, opacity]) => (
              <stop key={offset} offset={offset} style={{ stopColor: tokenColor(token), stopOpacity: opacity }} />
            ))}
          </linearGradient>
        ))}
        {/* luminance mask: everything shows except the frame faces the beam passes behind */}
        <mask id="auth-iso-beam" maskUnits="userSpaceOnUse" x="0" y="251.91" width="516.12" height="475.82">
          <rect x="0" y="251.91" width="516.12" height="475.82" fill="white" />
          {ISO_BEAM_CUTS.map((points) => (
            <polygon key={points} points={points} fill="black" />
          ))}
        </mask>
      </defs>
      <g className={styles.rise}>
        <svg x="152" y="-203" width="396" height="753" viewBox="0 0 516.12 981" overflow="visible">
          {ISO_FACES.map((face) => (
            <polygon
              key={face.points}
              points={face.points}
              fill={`url(#auth-iso-${face.grad})`}
              mask={face.masked ? "url(#auth-iso-beam)" : undefined}
            />
          ))}
        </svg>
      </g>
    </svg>
  );
}

export function StoryPanel() {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const step = (by: number) => setIndex((i) => (i + by + SLIDES.length) % SLIDES.length);

  return (
    <aside className={styles.story} aria-roledescription="carousel" aria-label="What CommerceOS does">
      <i className={`${styles.blob} ${styles.b1}`} aria-hidden="true" />
      <i className={`${styles.blob} ${styles.b2}`} aria-hidden="true" />
      <i className={`${styles.blob} ${styles.b3}`} aria-hidden="true" />
      <IsoArt />
      <svg className={styles.grain} aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <filter id="auth-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={1} seed={9} />
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.35 0 0 0 -0.1" />
        </filter>
        <rect width="100%" height="100%" filter="url(#auth-grain)" />
      </svg>

      <div className={styles.glass}>
        <div key={index} className={styles.slide} aria-live="polite" aria-atomic="true">
          <span className={styles.eyebrow}>
            <i aria-hidden="true" />
            {slide.eyebrow}
          </span>
          <p className={styles.headline}>{slide.headline}</p>
        </div>
        <div className={styles.dots} aria-hidden="true">
          {SLIDES.map((s, i) => (
            <i key={s.eyebrow} className={i === index ? styles.dotOn : undefined} />
          ))}
        </div>
      </div>

      <div className={styles.notch}>
        <button type="button" className={styles.arrow} aria-label="Previous slide" onClick={() => step(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <button type="button" className={`${styles.arrow} ${styles.next}`} aria-label="Next slide" onClick={() => step(1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
