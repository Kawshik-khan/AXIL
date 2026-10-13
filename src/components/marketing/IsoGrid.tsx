"use client";

import { useEffect, useRef } from "react";
import { c } from "./classes";

/**
 * An isometric grid drawn on a canvas behind a section. Cells light up under the pointer and fade out behind it,
 * a click sends a ripple outwards, and while nobody points at it a few cells pulse on their own. Colours come from
 * the canvas's CSS (`--iso-line`, `--iso-lit`). With reduced motion it is drawn once and stays still; it only
 * animates while on screen. Changing `flash` to a new number sends one wave across the whole grid (the login page
 * uses it to say "unlocked").
 */

const SIDE = 64; // rhombus edge in px; lines run at ±30°, like the other grids on the page
const W = SIDE * Math.cos(Math.PI / 6);
const H = SIDE * Math.sin(Math.PI / 6);
const DECAY_PER_MS = 0.0011;

type Cell = { i: number; j: number; v: number };

/** A number in [0, 1) for picking which cell pulses next (decoration only). */
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

export function IsoGrid({ flash = 0 }: { flash?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wave = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (flash) wave.current?.();
  }, [flash]);

  useEffect(() => {
    const el = canvas.current;
    const host = el?.parentElement;
    const ctx = el?.getContext("2d");
    if (!el || !host || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lit = new Map<string, Cell>();
    let width = 0;
    let height = 0;
    let lineColor = "";
    let litColor = "";
    let frame = 0;
    let last = 0;
    let visible = false;
    let pointerInside = false;
    let ambientAt = 0;

    // A point is u·A + v·B with A = (W, H) and B = (W, -H); a cell is one unit square in (u, v).
    const toCell = (x: number, y: number) => ({ i: Math.floor((x / W + y / H) / 2), j: Math.floor((x / W - y / H) / 2) });
    const point = (u: number, v: number): [number, number] => [(u + v) * W, (u - v) * H];

    const light = (i: number, j: number, v: number) => {
      const key = `${i},${j}`;
      const cell = lit.get(key);
      if (cell) cell.v = Math.max(cell.v, v);
      else lit.set(key, { i, j, v });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const style = getComputedStyle(el);
      lineColor = style.getPropertyValue("--iso-line").trim();
      litColor = style.getPropertyValue("--iso-lit").trim();
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      for (const cell of lit.values()) {
        const corners = [point(cell.i, cell.j), point(cell.i + 1, cell.j), point(cell.i + 1, cell.j + 1), point(cell.i, cell.j + 1)];
        ctx.beginPath();
        corners.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = litColor;
        ctx.globalAlpha = cell.v * 0.32;
        ctx.fill();
        ctx.strokeStyle = litColor;
        ctx.globalAlpha = cell.v * 0.9;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // grid lines: every u = k and v = k that crosses the canvas
      const us = [0, width].flatMap((x) => [0, height].map((y) => (x / W + y / H) / 2));
      const vs = [0, width].flatMap((x) => [0, height].map((y) => (x / W - y / H) / 2));
      const [u0, u1] = [Math.floor(Math.min(...us)), Math.ceil(Math.max(...us))];
      const [v0, v1] = [Math.floor(Math.min(...vs)), Math.ceil(Math.max(...vs))];
      ctx.beginPath();
      for (let u = u0; u <= u1; u++) {
        ctx.moveTo(...point(u, v0));
        ctx.lineTo(...point(u, v1));
      }
      for (let v = v0; v <= v1; v++) {
        ctx.moveTo(...point(u0, v));
        ctx.lineTo(...point(u1, v));
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const tick = (now: number) => {
      const dt = last ? now - last : 16;
      last = now;
      for (const [key, cell] of lit) {
        cell.v -= dt * DECAY_PER_MS;
        if (cell.v <= 0) lit.delete(key);
      }
      if (!pointerInside && now > ambientAt) {
        const { i, j } = toCell(random() * width, random() * height);
        light(i, j, 0.55);
        ambientAt = now + 450 + random() * 700;
      }
      draw();
      frame = visible ? requestAnimationFrame(tick) : 0;
    };

    const start = () => {
      if (reduce || frame || !visible) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return toCell(e.clientX - r.left, e.clientY - r.top);
    };

    const onMove = (e: PointerEvent) => {
      pointerInside = true;
      const { i, j } = local(e);
      light(i, j, 1);
      light(i + 1, j, 0.35);
      light(i - 1, j, 0.35);
      light(i, j + 1, 0.35);
      light(i, j - 1, 0.35);
      start();
    };
    const onLeave = () => {
      pointerInside = false;
    };
    // a ripple: rings of cells light up one after another, dimmer the further out
    const ripples: number[] = [];
    const onDown = (e: PointerEvent) => {
      const { i, j } = local(e);
      for (let ring = 0; ring <= 6; ring++) {
        ripples.push(
          window.setTimeout(() => {
            for (let di = -ring; di <= ring; di++)
              for (let dj = -ring; dj <= ring; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === ring) light(i + di, j + dj, 1 - ring * 0.13);
            start();
          }, ring * 70),
        );
      }
    };

    // one wave from the centre across every cell on the canvas, brightest near the middle
    wave.current = () => {
      if (reduce) return;
      const centre = toCell(width / 2, height / 2);
      const corners = [toCell(0, 0), toCell(width, 0), toCell(0, height), toCell(width, height)];
      const reach = Math.max(...corners.map((k) => Math.max(Math.abs(k.i - centre.i), Math.abs(k.j - centre.j))));
      for (let ring = 0; ring <= reach; ring++) {
        ripples.push(
          window.setTimeout(() => {
            for (let di = -ring; di <= ring; di++)
              for (let dj = -ring; dj <= ring; dj++)
                if (Math.max(Math.abs(di), Math.abs(dj)) === ring) light(centre.i + di, centre.j + dj, Math.max(0.25, 1 - ring / (reach + 2)));
            start();
          }, ring * 45),
        );
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    observer.observe(host);
    const sizer = new ResizeObserver(resize);
    sizer.observe(host);
    resize();

    if (!reduce) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("pointerdown", onDown);
    }
    return () => {
      wave.current = null;
      observer.disconnect();
      sizer.disconnect();
      cancelAnimationFrame(frame);
      ripples.forEach((id) => window.clearTimeout(id));
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return <canvas ref={canvas} className={c("isogrid")} aria-hidden="true" />;
}
