"use client";

import { useEffect, useRef } from "react";
import styles from "../super-admin.module.css";

/**
 * The console background: a topographic contour map in thin ink lines over a faint survey grid, behind the cards.
 * The contours are drawn live (marching squares) from a gentle height map, so they can answer the pointer: the
 * pointer presses a soft bump into the map and the nearby contours bend around it, settling back when it leaves.
 * The contour under the pointer turns lime near it, and the two survey markers glow when the pointer comes close.
 * Two layers show the same map: underneath, a softly blurred copy across the whole screen; on top, the sharp map seen
 * only through a round "lens" that follows the pointer, so the area under the pointer comes into focus.
 * Nothing moves on its own; with reduced motion the map is drawn once, blurred, and stays still. Colours come from the
 * canvas's CSS (`--topo-line`, `--topo-grid`, `--topo-lit`, `--topo-glow`, `--topo-mark`).
 */

const CELL = 12; // marching-squares cell, in px
const LEVELS = Array.from({ length: 22 }, (_, i) => 0.06 + i * 0.045); // close together, so the pointer's bump shows as rings
const GRID = 50; // survey grid spacing, in px
const GRID_OPACITY = 0.20; // the survey grid at 20% strength, well behind the contours
const BUMP_SIGMA = 110; // how wide the pointer's bump is, in px
const BUMP_HEIGHT = 0.32;
const LIT_RADIUS = 170; // how far along the lit contour the lime reaches from the pointer

// the terrain: peaks (positive) and basins (negative) placed in fractions of the screen, so it fits any size
const BLOBS: readonly [number, number, number, number][] = [
  // x, y, height, spread (fraction of the screen diagonal)
  [0.14, 0.22, 0.85, 0.2],
  [0.82, 0.18, 0.75, 0.17],
  [0.68, 0.78, 0.95, 0.22],
  [0.18, 0.86, 0.6, 0.15],
  [0.46, 0.5, -0.45, 0.14],
  [0.95, 0.55, 0.4, 0.12],
];
// survey markers, in fractions of the screen
const MARKS: readonly [number, number][] = [
  [0.36, 0.49],
  [0.7, 0.2],
];

type Colors = { line: string; grid: string; lit: string; glow: string; mark: string };

function readColors(el: HTMLElement): Colors | null {
  const s = getComputedStyle(el);
  const c = {
    line: s.getPropertyValue("--topo-line").trim(),
    grid: s.getPropertyValue("--topo-grid").trim(),
    lit: s.getPropertyValue("--topo-lit").trim(),
    glow: s.getPropertyValue("--topo-glow").trim(),
    mark: s.getPropertyValue("--topo-mark").trim(),
  };
  // In development the stylesheet can arrive after the first draw; never fall back to the canvas default (black).
  return Object.values(c).every(Boolean) ? c : null;
}

export function TopoGrid() {
  const ref = useRef<HTMLCanvasElement>(null); // the sharp map, seen through the lens
  const blurRef = useRef<HTMLCanvasElement>(null); // the blurred copy underneath

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    const blur = blurRef.current;
    const bctx = blur?.getContext("2d");
    if (!el || !ctx || !blur || !bctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let colors: Colors | null = null;
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let field = new Float32Array(0);
    let base = new Float32Array(0); // the terrain without the pointer, computed once per size
    let frame = 0;
    let last = 0;
    const target = { x: 0, y: 0, on: 0 };
    const pos = { x: 0, y: 0, on: 0 };

    const buildBase = () => {
      cols = Math.ceil(width / CELL) + 1;
      rows = Math.ceil(height / CELL) + 1;
      base = new Float32Array(cols * rows);
      field = new Float32Array(cols * rows);
      const diag = Math.hypot(width, height);
      for (let j = 0; j < rows; j++) {
        const y = j * CELL;
        for (let i = 0; i < cols; i++) {
          const x = i * CELL;
          // rolling ground everywhere (so no part of the screen is flat and empty), with the hills on top
          let v =
            0.42 +
            0.16 * Math.sin(x / 260 + 1.3) * Math.cos(y / 310 - 0.7) +
            0.11 * Math.sin((x + y) / 420 + 2.1) +
            0.07 * Math.cos((x - y) / 190 + 0.4) +
            0.05 * Math.sin(x / 120 - y / 150);
          for (const [bx, by, h, s] of BLOBS) {
            const dx = x - bx * width;
            const dy = y - by * height;
            const sd = s * diag;
            v += 0.55 * h * Math.exp(-(dx * dx + dy * dy) / (2 * sd * sd));
          }
          base[j * cols + i] = v;
        }
      }
      // stretch the terrain to just inside the contour levels, so no peak rises above the top level and no basin
      // sinks below the bottom one (those areas would be flat and empty)
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of base) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const from = LEVELS[0] - 0.02;
      const to = LEVELS[LEVELS.length - 1] + 0.02 - BUMP_HEIGHT * 0.5; // leave room for the pointer's bump
      const scale = hi > lo ? (to - from) / (hi - lo) : 1;
      for (let n = 0; n < base.length; n++) base[n] = from + (base[n] - lo) * scale;
    };

    const buildField = () => {
      field.set(base);
      if (pos.on < 0.005) return;
      const amp = BUMP_HEIGHT * pos.on;
      const reach = BUMP_SIGMA * 3;
      const i0 = Math.max(0, Math.floor((pos.x - reach) / CELL));
      const i1 = Math.min(cols - 1, Math.ceil((pos.x + reach) / CELL));
      const j0 = Math.max(0, Math.floor((pos.y - reach) / CELL));
      const j1 = Math.min(rows - 1, Math.ceil((pos.y + reach) / CELL));
      const k = 1 / (2 * BUMP_SIGMA * BUMP_SIGMA);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const dx = i * CELL - pos.x;
          const dy = j * CELL - pos.y;
          field[j * cols + i] += amp * Math.exp(-(dx * dx + dy * dy) * k);
        }
    };

    /** Adds the contour at `level` to the current path (marching squares with linear interpolation). */
    const contour = (level: number) => {
      const lerp = (a: number, b: number) => (level - a) / (b - a);
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = field[j * cols + i]; // top left
          const b = field[j * cols + i + 1]; // top right
          const c = field[(j + 1) * cols + i + 1]; // bottom right
          const d = field[(j + 1) * cols + i]; // bottom left
          const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const x = i * CELL;
          const y = j * CELL;
          const top = (): [number, number] => [x + CELL * lerp(a, b), y];
          const right = (): [number, number] => [x + CELL, y + CELL * lerp(b, c)];
          const bottom = (): [number, number] => [x + CELL * lerp(d, c), y + CELL];
          const left = (): [number, number] => [x, y + CELL * lerp(a, d)];
          const seg = (p: [number, number], q: [number, number]) => {
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
          };
          switch (idx) {
            case 1: case 14: seg(left(), bottom()); break;
            case 2: case 13: seg(bottom(), right()); break;
            case 3: case 12: seg(left(), right()); break;
            case 4: case 11: seg(top(), right()); break;
            case 6: case 9: seg(top(), bottom()); break;
            case 7: case 8: seg(left(), top()); break;
            case 5: seg(left(), top()); seg(bottom(), right()); break;
            case 10: seg(top(), right()); seg(left(), bottom()); break;
          }
        }
      }
    };

    const valueAt = (x: number, y: number) => {
      const i = Math.min(cols - 1, Math.max(0, Math.round(x / CELL)));
      const j = Math.min(rows - 1, Math.max(0, Math.round(y / CELL)));
      return field[j * cols + i];
    };

    const draw = () => {
      if (!colors) return;
      ctx.clearRect(0, 0, width, height);

      // survey grid: thin lines with small ticks where they cross
      ctx.beginPath();
      for (let x = GRID / 2; x < width; x += GRID) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = GRID / 2; y < height; y += GRID) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.globalAlpha = GRID_OPACITY;
      ctx.stroke();
      ctx.globalAlpha = 1;

      buildField();
      ctx.beginPath();
      for (const level of LEVELS) contour(level);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.stroke();

      if (pos.on > 0.01) {
        // the contour under the pointer, in lime near it
        const here = valueAt(pos.x, pos.y);
        let nearest = LEVELS[0];
        for (const l of LEVELS) if (Math.abs(l - here) < Math.abs(nearest - here)) nearest = l;
        const ink = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, LIT_RADIUS);
        ink.addColorStop(0, colors.lit);
        ink.addColorStop(0.6, colors.glow);
        ink.addColorStop(1, "transparent");
        ctx.save();
        ctx.globalAlpha = pos.on;
        ctx.beginPath();
        ctx.rect(pos.x - LIT_RADIUS, pos.y - LIT_RADIUS, LIT_RADIUS * 2, LIT_RADIUS * 2);
        ctx.clip();
        ctx.beginPath();
        contour(nearest);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.shadowColor = colors.lit;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();
      }

      // survey markers: a small ink dot that takes a lime halo when the pointer is near
      for (const [mx, my] of MARKS) {
        const x = mx * width;
        const y = my * height;
        const near = pos.on * Math.max(0, 1 - Math.hypot(pos.x - x, pos.y - y) / 160);
        if (near > 0.01) {
          ctx.globalAlpha = near;
          ctx.fillStyle = colors.glow;
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = near > 0.5 ? colors.lit : colors.mark;
        ctx.strokeStyle = colors.mark;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (near > 0.5) ctx.stroke();
      }

      // the blurred layer is a copy of this frame (its blur comes from CSS); the lens follows the pointer
      bctx.clearRect(0, 0, width, height);
      bctx.drawImage(el, 0, 0, width, height);
      el.style.setProperty("--lx", `${pos.x.toFixed(1)}px`);
      el.style.setProperty("--ly", `${pos.y.toFixed(1)}px`);
      el.style.opacity = pos.on.toFixed(3);
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 50) : 16;
      last = now;
      if (!colors) colors = readColors(el);
      const k = 1 - Math.exp(-dt / 90);
      pos.x += (target.x - pos.x) * k;
      pos.y += (target.y - pos.y) * k;
      pos.on += (target.on - pos.on) * (1 - Math.exp(-dt / 220));
      draw();
      const settled = Math.abs(target.x - pos.x) < 0.5 && Math.abs(target.y - pos.y) < 0.5 && Math.abs(target.on - pos.on) < 0.005;
      if (settled) pos.on = target.on;
      frame = settled && colors ? 0 : requestAnimationFrame(tick);
      if (!frame) last = 0;
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      for (const [c, cx] of [
        [el, ctx],
        [blur, bctx],
      ] as const) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      buildBase();
      colors = readColors(el);
      draw();
      if (!colors) start(); // the stylesheet is not there yet: try again on the next frames
    };

    const onMove = (e: PointerEvent) => {
      if (target.on === 0 && pos.on < 0.05) {
        pos.x = e.clientX; // start the bump where the pointer is instead of sliding in from elsewhere
        pos.y = e.clientY;
      }
      target.x = e.clientX;
      target.y = e.clientY;
      target.on = 1;
      start();
    };
    const onLeave = () => {
      target.on = 0;
      start();
    };

    resize();
    window.addEventListener("resize", resize);
    // the console's light / dark switch changes the colours: read them again and redraw
    const themeWatch = new MutationObserver(() => {
      colors = readColors(el);
      draw();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-console-theme"] });
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      window.addEventListener("blur", onLeave);
    }
    return () => {
      themeWatch.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <>
      <canvas ref={blurRef} className={`${styles.topoGrid} ${styles.topoBlur}`} aria-hidden="true" />
      <canvas ref={ref} className={`${styles.topoGrid} ${styles.topoLens}`} aria-hidden="true" />
    </>
  );
}
