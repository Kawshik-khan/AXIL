// CommerceOS figures, drawn in the Hairline style (isometric line art that answers the pointer).
//
//   channels(el, opts)   several channels feed one order desk
//   pipeline(el, opts)   an order becomes a parcel; move the pointer along the belt to scrub it
//   gate(el, opts)       parcels wait at a barrier until a human approves
//   zones(el, opts)      delivery zones; point at a zone to lift it
//   lattice(el, opts)    a faded isometric grid cube; cells light up under the pointer (every cell is a record)
//   shopfront(el, opts)  a shop padlocked shut; option `state` locks, checks and opens it (the sign-in page)
//
// Same shape as the Hairline functions: fn(element, options) -> { update(options), destroy() }.
// Options (all optional): intensity 0..1 (default 0.5), theme "auto"|"light"|"dark", label, onRead(text), play.
// Colors come from the same CSS variables as Hairline: --hairline-plate, -hi, -edge, -mid, -lo, -stroke.
// lattice also reads --hairline-accent (default lime) for its lit cells.
// The figures show no numbers and no brand names: they say things with geometry.

const NS = "http://www.w3.org/2000/svg";
const K = Math.cos(Math.PI / 6);
const W = 500;
const H = 400;

const STYLE = `
[data-cos-figure]{display:block;position:relative;aspect-ratio:5/4;touch-action:pan-y;user-select:none;-webkit-user-select:none;
--hl-plate:var(--hairline-plate,#ffffff);--hl-hi:var(--hairline-hi,#232327);--hl-edge:var(--hairline-edge,#a4a4ac);--hl-mid:var(--hairline-mid,#c3c3c9);--hl-lo:var(--hairline-lo,#e0e0e4);--hl-sw:var(--hairline-stroke,0.9)}
[data-cos-figure][data-theme="dark"]{--hl-plate:var(--hairline-plate,#08090a);--hl-hi:var(--hairline-hi,#d0d6e0);--hl-edge:var(--hairline-edge,#5b5d64);--hl-mid:var(--hairline-mid,#3e3e44);--hl-lo:var(--hairline-lo,#29292d)}
[data-cos-figure]:focus-visible{outline:1px solid var(--hl-hi);outline-offset:4px}
[data-cos-figure] svg{display:block;width:100%;height:100%;overflow:visible}
[data-cos-figure] .p,[data-cos-figure] .ln,[data-cos-figure] .mid{stroke-width:var(--hl-sw);stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
[data-cos-figure] .p{fill:var(--hl-plate);stroke:var(--hl-edge)}
[data-cos-figure] .s{fill:var(--hl-lo)}
[data-cos-figure] .ln{fill:none;stroke:var(--hl-edge)}
[data-cos-figure] .mid{fill:none;stroke:var(--hl-mid)}
[data-cos-figure] .hi{stroke:var(--hl-hi)}
[data-cos-figure] .dot{fill:var(--hl-hi);stroke:none}
[data-cos-figure] .acc{fill:var(--hairline-accent,#C7F900)}
`;

let styled = false;
function injectStyle() {
  if (styled || typeof document === "undefined") return;
  const s = document.createElement("style");
  s.setAttribute("data-cos-figure-style", "");
  s.textContent = STYLE;
  document.head.append(s);
  styled = true;
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (v, t, dt, k = 14) => {
  const n = v + (t - v) * (1 - Math.exp(-k * dt));
  return Math.abs(t - n) < 0.002 ? t : n;
};
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

// one shared animation loop; a figure that is off-screen or settled does no work
const live = new Set();
let raf = 0;
let last = 0;
function wake(f) {
  live.add(f);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
}
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const f of [...live]) {
    if (!f.visible) {
      live.delete(f);
      continue;
    }
    const more = f.step(dt);
    f.draw();
    if (!more) live.delete(f);
  }
  raf = live.size ? requestAnimationFrame(loop) : 0;
}

// ---- isometric drawing helpers (return SVG markup) ----
const mkP = (S, cx, cy) => {
  const P = (x, y, z = 0) => [(cx + (x - y) * K * S).toFixed(1), (cy + (x + y) * 0.5 * S - z * S).toFixed(1)];
  P.S = S;
  return P;
};
const pts = (a) => a.map((p) => p.join(",")).join(" ");
const poly = (a, c) => `<polygon class="${c}" points="${pts(a)}"/>`;
const line = (a, c) => `<polyline class="${c}" points="${pts(a)}"/>`;

function box(P, x, y, z, w, d, h, hiTop) {
  const top = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  const right = [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)];
  const front = [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  return poly(front, "p") + poly(right, "p s") + poly(top, hiTop ? "p hi" : "p");
}
const cbox = (P, cx, cy, z, w, d, h, hiTop) => box(P, cx - w / 2, cy - d / 2, z, w, d, h, hiTop);

function ellipse(P, cx, cy, z, r, c) {
  const [ex, ey] = P(cx, cy, z);
  return `<ellipse class="${c}" cx="${ex}" cy="${ey}" rx="${(r * Math.SQRT2 * K * P.S).toFixed(1)}" ry="${(r * Math.SQRT1_2 * P.S).toFixed(1)}"/>`;
}
function cylinder(P, cx, cy, z, r, h, hiTop) {
  const [bx, by] = P(cx, cy, z);
  const [, ty] = P(cx, cy, z + h);
  const rx = r * Math.SQRT2 * K * P.S;
  const ry = r * Math.SQRT1_2 * P.S;
  const body = `<path class="p" d="M${(bx - rx).toFixed(1)},${ty} L${(bx - rx).toFixed(1)},${by} A${rx.toFixed(1)},${ry.toFixed(1)} 0 0 0 ${(+bx + rx).toFixed(1)},${by} L${(+bx + rx).toFixed(1)},${ty}"/>`;
  return body + ellipse(P, cx, cy, z + h, r, hiTop ? "p hi" : "p");
}
function pyramid(P, cx, cy, z, half, h, hiTop) {
  const a = [cx - half, cy - half];
  const b = [cx + half, cy - half];
  const c = [cx + half, cy + half];
  const d = [cx - half, cy + half];
  const apex = P(cx, cy, z + h);
  const front = [P(d[0], d[1], z), P(c[0], c[1], z), apex];
  const right = [P(b[0], b[1], z), P(c[0], c[1], z), apex];
  void a;
  return poly(front, hiTop ? "p hi" : "p") + poly(right, hiTop ? "p s hi" : "p s");
}

// ---- the figure shell ----
function figure(el, opts, build) {
  injectStyle();
  const o = { intensity: 0.5, theme: "auto", label: undefined, onRead: undefined, play: false };
  const ctx = {
    o,
    ptr: { x: 250, y: 200, over: false },
    touched: false,
    say(text) {
      if (text !== ctx.caption) {
        ctx.caption = text;
        if (typeof o.onRead === "function") o.onRead(text);
      }
    },
    caption: "",
    get auto() {
      return !!o.play && !reduced() && !ctx.touched;
    },
    get motion() {
      return !reduced();
    },
    poke: () => wake(f),
  };

  const apply = (n = {}) => {
    for (const k of Object.keys(n)) {
      if (n[k] === undefined) {
        o[k] = { intensity: 0.5, theme: "auto", label: undefined, onRead: undefined, play: false }[k];
      } else o[k] = n[k];
    }
    o.intensity = typeof o.intensity === "number" && isFinite(o.intensity) ? clamp(o.intensity, 0, 1) : 0.5;
    const dark =
      o.theme === "dark" ||
      (o.theme === "auto" &&
        (!!el.closest(".dark,[data-theme='dark']") || (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches)));
    el.dataset.theme = dark ? "dark" : "light";
    svg.setAttribute("aria-label", o.label || el.getAttribute("aria-label") || spec.label);
  };

  el.setAttribute("data-cos-figure", "");
  el.tabIndex = 0;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  const g = document.createElementNS(NS, "g");
  svg.append(g);
  el.append(svg);

  const spec = build(ctx);
  const f = {
    visible: true,
    step: (dt) => spec.step(dt),
    draw: () => {
      g.innerHTML = spec.draw();
    },
  };
  apply(opts);
  f.draw();

  const local = (e) => {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const onMove = (e) => {
    const [x, y] = local(e);
    ctx.ptr.x = x;
    ctx.ptr.y = y;
    ctx.ptr.over = true;
    ctx.touched = true;
    wake(f);
  };
  const onLeave = () => {
    ctx.ptr.over = false;
    wake(f);
  };
  const onFocus = () => {
    ctx.ptr.x = 250;
    ctx.ptr.y = 200;
    ctx.ptr.over = true;
    ctx.touched = true;
    wake(f);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerdown", onMove);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("pointercancel", onLeave);
  el.addEventListener("focus", onFocus);
  el.addEventListener("blur", onLeave);

  let io = null;
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        f.visible = en.isIntersecting;
        if (f.visible && (ctx.auto || ctx.ptr.over)) wake(f);
      }
    });
    io.observe(el);
  }
  if (ctx.auto) wake(f);

  return {
    update(n) {
      apply(n);
      f.draw();
      wake(f);
    },
    destroy() {
      live.delete(f);
      io?.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onLeave);
      el.removeAttribute("data-cos-figure");
      el.removeAttribute("data-theme");
      el.removeAttribute("tabindex");
      svg.remove();
    },
  };
}

// =====================================================================
// channels: messages from every channel stream in, gather at one hub, and leave as orders
// (option `ambient: true` keeps the flow running even after the pointer has visited)
// =====================================================================
export function channels(el, opts) {
  return figure(el, opts, (c) => {
    const P = mkP(33, 250, 205);
    const R = 4.2; // tile centre distance from the hub
    const EDGE = 5.3; // outer edge of a tile
    const FAR = 7.9; // where the inbound streams start
    const dirs = [
      [-1, 0],
      [0, -1],
      [1, 0],
      [0, 1],
    ];
    const names = ["Web store", "Facebook", "Instagram", "Messaging"];
    const st = {
      lift: [0, 0, 0, 0],
      bump: [0, 0, 0, 0],
      pulse: 0,
      feeds: [],
      packets: [],
      ripples: [],
      out: [],
      arrivals: 0,
      timer: 0.2,
      hov: -1,
      next: 0,
      seed: 12345,
    };
    const rand = () => {
      st.seed = (Math.imul(st.seed, 1664525) + 1013904223) >>> 0;
      return st.seed / 4294967296;
    };
    const flowing = () => st.hov >= 0 || c.auto || (!!c.o.ambient && c.motion);

    const hover = () => {
      if (!c.ptr.over) return -1;
      let best = 1e9;
      let at = -1;
      dirs.forEach((d, i) => {
        const [sx, sy] = P(d[0] * R, d[1] * R, 0.4);
        const dist = Math.hypot(c.ptr.x - sx, (c.ptr.y - sy) * 1.4);
        if (dist < best) {
          best = dist;
          at = i;
        }
      });
      return best < 80 ? at : -1;
    };

    // two files per stream make it read as a flow, not a single dot
    const spawnFeed = (ch) => {
      st.feeds.push({ ch, t: 0, lane: rand() < 0.5 ? -0.3 : 0.3 });
    };

    return {
      label: "Messages from every channel streaming into one hub that turns them into orders",
      step(dt) {
        const o = c.o;
        const hov = hover();
        if (hov !== st.hov) {
          st.hov = hov;
          c.say(hov >= 0 ? `${names[hov]} orders arrive in one place` : "");
        }
        let moving = false;
        for (let i = 0; i < 4; i++) {
          const target = i === hov ? 0.35 + o.intensity * 0.8 : 0;
          st.lift[i] = c.motion ? ease(st.lift[i], target, dt) : target;
          if (st.lift[i] !== target) moving = true;
          st.bump[i] = Math.max(0, st.bump[i] - dt * 3.2);
          if (st.bump[i] > 0.01) moving = true;
        }
        const on = flowing();
        if (on) {
          st.timer -= dt;
          if (st.timer <= 0) {
            const ch = hov >= 0 && rand() < 0.6 ? hov : st.next++ % 4;
            spawnFeed(ch);
            if (rand() < 0.4) spawnFeed((ch + 1 + Math.floor(rand() * 3)) % 4);
            st.timer = (hov >= 0 ? 0.26 : 0.36) / (0.4 + o.intensity);
          }
        }
        const feedSpeed = ((3 + 3 * o.intensity) / (FAR - EDGE));
        for (const f of st.feeds) f.t += dt * feedSpeed;
        const landed = st.feeds.filter((f) => f.t >= 1);
        st.feeds = st.feeds.filter((f) => f.t < 1);
        for (const f of landed) {
          st.bump[f.ch] = 1;
          st.packets.push({ ch: f.ch, t: 0 });
        }

        const speed = (2 + 3 * o.intensity) / (EDGE - 2.2 - 1.2);
        for (const p of st.packets) p.t += dt * speed;
        const done = st.packets.filter((p) => p.t >= 1);
        st.packets = st.packets.filter((p) => p.t < 1);
        for (const p of done) {
          st.pulse = 1;
          st.ripples.push({ t: 0 });
          st.arrivals++;
          if (st.arrivals % 3 === 0) st.out.push({ t: 0 });
        }
        st.pulse = Math.max(0, st.pulse - dt * 3);
        for (const r of st.ripples) r.t += dt * 1.1;
        st.ripples = st.ripples.filter((r) => r.t < 1);
        for (const r of st.out) r.t += dt / 1.4;
        st.out = st.out.filter((r) => r.t < 1);

        return on || moving || st.feeds.length > 0 || st.packets.length > 0 || st.ripples.length > 0 || st.out.length > 0 || st.pulse > 0.01;
      },
      draw() {
        let out = "";
        // inbound streams and rails on the ground
        for (const [dx, dy] of dirs) {
          out += line([P(dx * FAR, dy * FAR, 0), P(dx * EDGE, dy * EDGE, 0)], "mid").replace("<polyline", '<polyline stroke-dasharray="2 6"');
          const px = -dy * 0.28;
          const py = dx * 0.28;
          const a = 1.25;
          const b = 3.1;
          out += poly(
            [P(dx * a + px, dy * a + py, 0), P(dx * b + px, dy * b + py, 0), P(dx * b - px, dy * b - py, 0), P(dx * a - px, dy * a - py, 0)],
            "ln",
          );
          out += line([P(dx * a, dy * a, 0), P(dx * b, dy * b, 0)], "mid");
        }
        // ripples spreading from the hub each time something arrives
        for (const r of st.ripples) {
          out += ellipse(P, 0, 0, 0.01, 1.5 + r.t * 2.6, "mid").replace("<ellipse", `<ellipse style="opacity:${(1 - r.t).toFixed(2)}"`);
        }
        const items = [];
        dirs.forEach(([dx, dy], i) => {
          const cx = dx * R;
          const cy = dy * R;
          const z = st.lift[i] + st.bump[i] * 0.22;
          const hot = i === st.hov || st.bump[i] > 0.5;
          let s = cbox(P, cx, cy, z, 2.2, 2.2, 0.35, hot);
          const gz = z + 0.35;
          if (i === 0) s += cbox(P, cx, cy, gz, 0.9, 0.9, 0.9);
          if (i === 1) s += cylinder(P, cx, cy, gz, 0.5, 0.9);
          if (i === 2) s += pyramid(P, cx, cy, gz, 0.55, 1.1);
          if (i === 3) s += cylinder(P, cx, cy, gz, 0.62, 0.3) + ellipse(P, cx, cy, gz + 0.3, 0.28, "ln");
          items.push({ k: cx + cy, s });
        });
        for (const f of st.feeds) {
          const [dx, dy] = dirs[f.ch];
          const d = FAR - f.t * (FAR - EDGE);
          const x = dx * d - dy * f.lane;
          const y = dy * d + dx * f.lane;
          items.push({ k: x + y, s: cbox(P, x, y, 0.04, 0.26, 0.26, 0.26) });
        }
        for (const p of st.packets) {
          const [dx, dy] = dirs[p.ch];
          const d = 3.1 - p.t * 1.9;
          const x = dx * d;
          const y = dy * d;
          items.push({ k: x + y + 0.01, s: cbox(P, x, y, 0.08 + st.lift[p.ch] * (1 - p.t), 0.42, 0.42, 0.42, true) });
        }
        const hh = 1 + st.pulse * 0.28;
        items.push({ k: 0, s: cbox(P, 0, 0, 0, 2.4, 2.4, hh, true) + ellipse(P, 0, 0, hh, 0.62, "ln") });
        // finished orders leave the hub, rising and shrinking
        for (const r of st.out) {
          const size = 0.7 * (1 - r.t * 0.85);
          items.push({ k: 0.5, s: cbox(P, 0, 0, hh + 0.1 + r.t * 3.4, size, size, size, true) });
        }
        items.sort((a, b) => a.k - b.k);
        return out + items.map((i) => i.s).join("");
      },
    };
  });
}


// =====================================================================
// pipeline: an order becomes a parcel along a belt; the pointer scrubs it
// =====================================================================
export function pipeline(el, opts) {
  return figure(el, opts, (c) => {
    const P = mkP(34, 250, 210);
    const X0 = -4.5;
    const SPAN = 9;
    const arches = [0.25, 0.5, 0.75];
    const stages = ["Order placed", "Confirmed", "Packed", "Out for delivery", "Delivered"];
    const st = { t: 0.08, hold: 0, stage: 0 };
    const stageOf = (t) => (t < 0.25 ? 0 : t < 0.5 ? 1 : t < 0.75 ? 2 : t < 0.95 ? 3 : 4);

    return {
      label: "An order moving along a belt, becoming a packed parcel and then a delivered one",
      step(dt) {
        const o = c.o;
        let target = st.t;
        let moving = false;
        if (c.ptr.over) {
          const a = (c.ptr.x - 250) / (K * P.S);
          const b = (c.ptr.y - 210 + 0.6 * P.S) / (0.5 * P.S);
          const x = (a + b) / 2;
          target = clamp((x - X0) / SPAN, 0, 1);
          st.t = c.motion ? ease(st.t, target, dt, 10) : target;
          moving = st.t !== target;
        } else if (c.auto) {
          if (st.t >= 1) {
            st.hold += dt;
            if (st.hold > 1.4) {
              st.t = 0;
              st.hold = 0;
            }
          } else st.t = Math.min(1, st.t + dt * (0.06 + 0.12 * o.intensity));
          moving = true;
        }
        const s = stageOf(st.t);
        if (s !== st.stage) {
          st.stage = s;
          c.say(stages[s]);
        }
        return moving || c.ptr.over;
      },
      draw() {
        const t = st.t;
        const px = X0 + SPAN * t;
        let out = box(P, -5, -1, 0, 10, 2, 0.3);
        for (let x = -4.5; x <= 4.6; x += 0.75) out += line([P(x, -1, 0.3), P(x, 1, 0.3)], "mid");
        const delivered = t > 0.95;
        out += ellipse(P, 4.5, 0, 0.3, 0.78, delivered ? "ln hi" : "ln");

        const items = [];
        for (const ta of arches) {
          const xa = X0 + SPAN * ta - 0.15;
          const near = Math.abs(t - ta) < 0.06;
          items.push({ k: xa - 1.3, s: box(P, xa, -1.45, 0, 0.3, 0.3, 1.9) });
          items.push({ k: xa + 1.35, s: box(P, xa, 1.2, 0, 0.3, 0.3, 1.9) });
          items.push({ k: xa, s: box(P, xa, -1.45, 1.6, 0.3, 2.95, 0.3, near) });
        }
        const h = 0.12 + 0.68 * smooth((t - 0.42) / 0.16);
        const w = 1.0;
        const d = 0.8;
        let s = cbox(P, px, 0, 0.3, w, d, h);
        const strap = smooth((t - 0.7) / 0.1);
        if (strap > 0.05) {
          const x1 = px - 0.12;
          const x2 = px + 0.12;
          const yb = d / 2;
          const z0 = 0.3;
          s += poly([P(x1, -yb, z0 + h), P(x2, -yb, z0 + h), P(x2, yb, z0 + h), P(x1, yb, z0 + h)], "p hi");
          s += poly([P(x1, yb, z0), P(x2, yb, z0), P(x2, yb, z0 + h), P(x1, yb, z0 + h)], "p hi");
        }
        items.push({ k: px, s });
        items.sort((a, b) => a.k - b.k);
        return out + items.map((i) => i.s).join("");
      },
    };
  });
}

// =====================================================================
// gate: parcels wait at a barrier until a human lifts it
// =====================================================================
export function gate(el, opts) {
  return figure(el, opts, (c) => {
    const P = mkP(34, 250, 225);
    const STOP = -0.9;
    const st = { open: 0, parcels: [-0.9, -1.8, -2.7].map((x) => ({ x })), spawn: 0, clock: 0, said: "" };
    const approved = () => c.ptr.over || (c.auto && st.clock % 5 > 1.4 && st.clock % 5 < 3.6);

    return {
      label: "A barrier holding parcels back until a person approves and lifts it",
      step(dt) {
        const o = c.o;
        if (c.auto) st.clock += dt;
        const want = approved() ? 1 : 0;
        const prev = st.open;
        st.open = c.motion ? ease(st.open, want, dt, 7) : want;
        const closed = st.open < 0.45;
        const v = 1.6 * (0.6 + o.intensity);
        let moving = st.open !== want;

        const sending = c.ptr.over || c.auto;
        if (sending) {
          st.spawn -= dt;
          const tail = st.parcels.length ? Math.min(...st.parcels.map((p) => p.x)) : 99;
          if (st.spawn <= 0 && tail > -4.1 && st.parcels.length < 7) {
            st.parcels.push({ x: -5 });
            st.spawn = 1.1 / (0.5 + o.intensity);
          }
        }
        let limit = closed ? STOP : Infinity;
        for (const p of [...st.parcels].sort((a, b) => b.x - a.x)) {
          const nx = Math.min(p.x + v * dt, limit);
          if (nx !== p.x) moving = true;
          p.x = nx;
          limit = Math.min(limit, p.x - 0.85);
        }
        st.parcels = st.parcels.filter((p) => p.x < 5.3);

        const say = st.open > 0.5 ? "Approved by a person, parcels released" : "Waiting for a person to approve";
        if (say !== st.said && (prev !== st.open || !st.said)) {
          st.said = say;
          c.say(say);
        }
        return moving || sending;
      },
      draw() {
        const open = st.open;
        const ang = open * 1.36;
        let out = box(P, -5, -1, 0, 10, 2, 0.2);
        const items = [];
        // post and lamp
        const lamp = open > 0.5;
        items.push({ k: 1.6, s: box(P, -0.2, 1.4, 0, 0.4, 0.4, 1.4) + box(P, -0.12, 1.48, 1.4, 0.24, 0.24, 0.26, lamp) });
        // arm: rotates up about the post top
        const L = 3.2;
        const ex = [0.09, -0.09];
        const px0 = 0;
        const py0 = 1.6;
        const pz0 = 1.1;
        const ey = py0 - L * Math.cos(ang);
        const ez = pz0 + L * Math.sin(ang);
        const arm = poly(
          [P(px0 - ex[0], py0, pz0), P(px0 + ex[0], py0, pz0), P(px0 + ex[0], ey, ez), P(px0 - ex[0], ey, ez)],
          lamp ? "p hi" : "p",
        );
        let stripes = "";
        for (let i = 1; i <= 4; i++) {
          const f = i / 5;
          const sy = py0 - L * Math.cos(ang) * f;
          const sz = pz0 + L * Math.sin(ang) * f;
          stripes += line([P(px0 - ex[0], sy, sz), P(px0 + ex[0], sy, sz)], "mid");
        }
        items.push({ k: 0, s: arm + stripes });
        for (const p of st.parcels) items.push({ k: p.x, s: cbox(P, p.x, 0, 0.2, 0.62, 0.62, 0.62, open > 0.5) });
        items.sort((a, b) => a.k - b.k);
        return out + items.map((i) => i.s).join("");
      },
    };
  });
}

// =====================================================================
// zones: delivery zones around a warehouse; point at a zone to lift it
// =====================================================================
export function zones(el, opts) {
  return figure(el, opts, (c) => {
    const P = mkP(34, 250, 215);
    const N = 7;
    const OFF = 3.5;
    const zoneOf = (x, y) => {
      const d = Math.max(x, y);
      return d <= 1 ? 0 : d <= 3 ? 1 : 2;
    };
    const names = ["Inner zone", "Nearby zone", "Outer zone"];
    const st = { lift: [0, 0, 0], hov: -1, clock: 0 };

    const hit = () => {
      if (!c.ptr.over) return -1;
      const a = (c.ptr.x - 250) / (K * P.S);
      const b = (c.ptr.y - 215 + 0.2 * P.S) / (0.5 * P.S);
      const gx = Math.floor((a + b) / 2 + OFF);
      const gy = Math.floor((b - a) / 2 + OFF);
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
      return zoneOf(gx, gy);
    };

    return {
      label: "A grid of delivery zones around a warehouse, with the zone under the pointer lifted",
      step(dt) {
        const o = c.o;
        let hov = hit();
        if (hov < 0 && c.auto) {
          st.clock += dt;
          hov = Math.floor(st.clock / 1.8) % 3;
        }
        if (hov !== st.hov) {
          st.hov = hov;
          c.say(hov >= 0 ? names[hov] : "");
        }
        let moving = false;
        for (let z = 0; z < 3; z++) {
          const target = z === hov ? 0.4 + o.intensity * 0.6 : 0;
          st.lift[z] = c.motion ? ease(st.lift[z], target, dt, 12) : target;
          if (st.lift[z] !== target) moving = true;
        }
        return moving || c.auto || c.ptr.over;
      },
      draw() {
        let out = "";
        for (let s = 0; s <= 2 * (N - 1); s++) {
          for (let x = 0; x < N; x++) {
            const y = s - x;
            if (y < 0 || y >= N) continue;
            const z = zoneOf(x, y);
            const lift = st.lift[z];
            const gx = x - OFF;
            const gy = y - OFF;
            out += box(P, gx + 0.04, gy + 0.04, lift, 0.92, 0.92, 0.14, lift > 0.12);
            if (x === 0 && y === 0) {
              const zb = lift + 0.14;
              out += box(P, gx + 0.4, gy + 0.4, zb, 0.2, 0.2, 1.3);
              out += poly([P(gx + 0.5, gy + 0.5, zb + 1.3), P(gx + 0.5, gy + 0.5, zb + 0.75), P(gx + 0.5, gy + 1.05, zb + 1.02)], "p hi");
            }
          }
        }
        return out;
      },
    };
  });
}

// =====================================================================
// lattice: a faded isometric grid cube; cells light up under the pointer
// =====================================================================
export function lattice(el, opts) {
  return figure(el, opts, (c) => {
    const N = 5;
    const P = mkP(34, 250, 200);
    // every cell on the three visible faces: top (z = N), front (y = N), right (x = N)
    const cells = [];
    const corners = (face, i, j) => {
      if (face === 0) return [P(i, j, N), P(i + 1, j, N), P(i + 1, j + 1, N), P(i, j + 1, N)];
      if (face === 1) return [P(i, N, j), P(i + 1, N, j), P(i + 1, N, j + 1), P(i, N, j + 1)];
      return [P(N, i, j), P(N, i + 1, j), P(N, i + 1, j + 1), P(N, i, j + 1)];
    };
    for (let face = 0; face < 3; face++) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const pts4 = corners(face, i, j);
          const mx = pts4.reduce((a, p) => a + +p[0], 0) / 4;
          const my = pts4.reduce((a, p) => a + +p[1], 0) / 4;
          cells.push({ id: cells.length, pts4, mx, my, level: 0, ttl: 0 });
        }
      }
    }
    const seed = [7, 19, 33, 41, 58, 66];
    const st = { hov: -1, clock: 0, next: 0 };
    seed.forEach((id) => (cells[id].level = 1));

    return {
      label: "A cube made of grid cells, a few of them lit",
      step(dt) {
        let hov = -1;
        if (c.ptr.over) {
          let best = 1e9;
          for (const k of cells) {
            const d = Math.hypot(c.ptr.x - k.mx, c.ptr.y - k.my);
            if (d < best) {
              best = d;
              hov = k.id;
            }
          }
          if (best > 40) hov = -1;
        }
        st.hov = hov;
        if (c.auto) {
          st.clock += dt;
          if (st.clock > 0.55 / (0.4 + c.o.intensity)) {
            st.clock = 0;
            const k = cells[(st.next++ * 29 + 11) % cells.length];
            k.ttl = 1.8;
          }
        }
        let busy = false;
        for (const k of cells) {
          if (k.ttl > 0) k.ttl -= dt;
          if (k.id === hov) k.ttl = c.motion ? 1.3 : 0; // the cell under the pointer stays lit, then fades slowly: a trail
          const target = k.id === hov || (seed.includes(k.id) && !c.touched) ? 1 : clamp(k.ttl, 0, 1);
          const n = c.motion ? ease(k.level, target, dt, 14) : target;
          if (n !== k.level) busy = true;
          k.level = n;
          if (k.ttl > 0) busy = true;
        }
        return busy || c.auto || c.ptr.over;
      },
      draw() {
        let out = "";
        for (const k of cells) {
          if (k.level > 0.02) out += `<polygon class="p acc" style="opacity:${k.level.toFixed(2)}" points="${pts(k.pts4)}"/>`;
        }
        // grid lines
        for (let i = 0; i <= N; i++) {
          out += line([P(i, 0, N), P(i, N, N)], "mid") + line([P(0, i, N), P(N, i, N)], "mid");
          out += line([P(i, N, 0), P(i, N, N)], "mid") + line([P(0, N, i), P(N, N, i)], "mid");
          out += line([P(N, i, 0), P(N, i, N)], "mid") + line([P(N, 0, i), P(N, N, i)], "mid");
        }
        // the cube's outline, with one stroke in the strong color
        out += poly([P(0, 0, N), P(N, 0, N), P(N, N, N), P(0, N, N)], "ln");
        out += line([P(0, N, N), P(0, N, 0), P(N, N, 0), P(N, 0, 0), P(N, 0, N)], "ln");
        out += line([P(N, N, 0), P(N, N, N)], "ln");
        if (st.hov >= 0) out += `<polygon class="ln hi" points="${pts(cells[st.hov].pts4)}"/>`;
        else out += line([P(0, N, N), P(N, N, N), P(N, 0, N)], "ln hi");
        return out;
      },
    };
  });
}

// =====================================================================
// shopfront: a shop with its rolling shutter padlocked shut, parcels stacked outside.
// Option `state`: "locked" (default) | "checking" | "unlocked".
//   locked    the pointer near the lock lifts its shackle a little; a stack under the pointer lifts
//   checking  the padlock jiggles and the shutter rattles
//   unlocked  the shackle swings open, the padlock drops away, the shutter rolls up and the shelves light up (lime)
// =====================================================================
export function shopfront(el, opts) {
  return figure(el, opts, (c) => {
    const P = mkP(36, 250, 250);
    const B = 0.22; // platform height: everything stands on it
    // shop body: x -2.7..2.7, y -2.6..1 (front plane y = 1), height 3.4
    const SX = 2.7;
    const FY = 1;
    const SH = 3.4;
    // shutter opening on the front plane
    const DX = 1.75;
    const DH = 2.65;
    const stacks = [
      { x: -3.4, y: 2.0, n: 3, lift: 0 },
      { x: 3.1, y: 1.3, n: 2, lift: 0 },
      { x: 2.9, y: 2.4, n: 1, lift: 0 },
    ];
    const st = { u: 0, t: 0, tease: 0, said: "" };
    const state = () => (c.o.state === "unlocked" || c.o.state === "checking" ? c.o.state : "locked");
    const phase = (a, b) => smooth((st.u - a) / (b - a));
    const near = (sx, sy, r) => c.ptr.over && Math.hypot(c.ptr.x - sx, c.ptr.y - sy) < r;

    return {
      label: "A shop with its shutter padlocked shut",
      step(dt) {
        const s = state();
        const target = s === "unlocked" ? 1 : 0;
        const prev = st.u;
        if (!c.motion) st.u = target;
        else st.u = target > st.u ? Math.min(1, st.u + dt / 0.95) : Math.max(0, st.u - dt / 0.5);
        st.t += dt;

        const lock = P(0, FY, B + 1.2);
        const tease = near(+lock[0], +lock[1], 90) && s === "locked" ? 1 : 0;
        const nt = c.motion ? ease(st.tease, tease, dt, 10) : tease;
        let busy = nt !== st.tease || st.u !== prev || s === "checking";
        st.tease = nt;
        for (const k of stacks) {
          const top = P(k.x, k.y, B + k.n * 0.82);
          const want = near(+top[0], +top[1] + 18, 46) ? 1 : 0;
          const n = c.motion ? ease(k.lift, want, dt, 12) : want;
          if (n !== k.lift) busy = true;
          k.lift = n;
        }

        const say = s === "unlocked" ? "The shutter rolls up and the shop opens" : s === "checking" ? "Checking the key" : "The shop is locked";
        if (say !== st.said) {
          st.said = say;
          c.say(say);
        }
        return busy;
      },
      draw() {
        const s = state();
        const shackle = phase(0, 0.3); // swings open
        const drop = phase(0.25, 0.5); // the padlock falls away
        const roll = phase(0.42, 0.9); // the shutter rolls up
        const jig = s === "checking" && c.motion ? Math.sin(st.t * 38) * 0.05 : 0;
        const rattle = s === "checking" && c.motion ? Math.abs(Math.sin(st.t * 19)) * 0.03 : 0;

        // platform
        const out = box(P, -4.2, -3.0, 0, 8.4, 6.2, B);
        const items = [];

        // ---- the shop ----
        let shop = box(P, -SX, -2.6, B, SX * 2, FY + 2.6, SH);
        // roof lip and the sign board above the shutter, with a dot that lights up when the shop opens
        shop += box(P, -SX - 0.15, FY - 0.15, B + SH, SX * 2 + 0.3, 0.45, 0.16);
        shop += box(P, -1.9, FY, B + DH + 0.22, 3.8, 0.14, 0.42);
        const signLit = phase(0.7, 1);
        const sign = [P(-0.16, FY + 0.14, B + DH + 0.32), P(0.16, FY + 0.14, B + DH + 0.32), P(0.16, FY + 0.14, B + DH + 0.54), P(-0.16, FY + 0.14, B + DH + 0.54)];
        shop += poly(sign, signLit > 0.5 ? "p acc" : "p");

        // the opening, then the shelves inside (lit one by one once the shutter is up)
        shop += poly([P(-DX, FY, B), P(DX, FY, B), P(DX, FY, B + DH), P(-DX, FY, B + DH)], "p s");
        let idx = 0;
        for (const z of [0.85, 1.75]) {
          shop += line([P(-DX, FY, B + z), P(DX, FY, B + z)], "mid");
          for (let i = 0; i < 5; i++) {
            const x = -DX + 0.25 + i * 0.66;
            const lit = phase(0.6 + idx * 0.035, 0.75 + idx * 0.035);
            idx++;
            const q = [P(x, FY, B + z), P(x + 0.44, FY, B + z), P(x + 0.44, FY, B + z + 0.5), P(x, FY, B + z + 0.5)];
            shop += lit > 0.02 ? `<polygon class="ln acc" style="opacity:${(0.35 + 0.65 * lit).toFixed(2)}" points="${pts(q)}"/>` : poly(q, "p");
          }
        }

        // the rolling shutter: its bottom edge rises as it rolls into the drum at the top
        const bottom = B + rattle + roll * (DH - 0.18);
        const topZ = B + DH;
        const sy = FY + 0.02;
        if (topZ - bottom > 0.02) {
          shop += poly([P(-DX, sy, bottom), P(DX, sy, bottom), P(DX, sy, topZ), P(-DX, sy, topZ)], "p");
          for (let z = topZ - 0.22; z > bottom + 0.05; z -= 0.22) shop += line([P(-DX, sy, z), P(DX, sy, z)], "mid");
          shop += line([P(-DX, sy, bottom + 0.12), P(DX, sy, bottom + 0.12)], "ln");
        }
        shop += box(P, -DX - 0.08, FY, topZ, DX * 2 + 0.16, 0.2, 0.22); // the drum
        if (bottom + 1.74 < topZ) shop += box(P, -0.14, sy, bottom + 1.44, 0.28, 0.12, 0.3, true); // the hasp the shackle passes through
        items.push({ k: -1, s: shop });

        // ---- the padlock, hanging from the hasp ----
        if (drop < 0.999) {
          const lz = B + 0.3 - drop * 1.6 + rattle; // body bottom
          const lx = jig;
          const w = 1.1;
          const h = 0.86;
          const d = 0.34;
          const ly = FY + 0.12;
          // shackle: a U in the lock's mid plane; the pointer lifts it a little, unlocking lifts it and swings it
          // about its right leg
          const r = 0.3;
          const leg = 0.38;
          const lift = 0.1 * st.tease * (0.5 + c.o.intensity) + shackle * 0.32;
          const ang = shackle * 1.25;
          const top = lz + h;
          const u = [];
          const add = (x, z) => {
            const dx = x - r;
            u.push(P(lx + r + dx * Math.cos(ang), ly + d / 2 + dx * Math.sin(ang), z));
          };
          add(-r, top + (shackle > 0.05 ? lift : 0));
          for (let i = 0; i <= 16; i++) {
            const a = Math.PI - (i / 16) * Math.PI;
            add(r * Math.cos(a), top + leg + lift + r * Math.sin(a));
          }
          add(r, top + lift);
          let lock = `<g style="opacity:${(1 - drop).toFixed(2)}">`;
          lock += line(u, "ln hi");
          lock += box(P, lx - w / 2, ly, lz, w, d, h, s === "unlocked");
          const kh = P(lx, ly + d, lz + h * 0.56);
          lock += `<circle class="dot" cx="${kh[0]}" cy="${kh[1]}" r="2.6"/>`;
          lock += line([P(lx, ly + d, lz + h * 0.52), P(lx, ly + d, lz + h * 0.3)], "ln hi");
          lock += "</g>";
          items.push({ k: 0.5, s: lock });
        }

        // ---- parcels outside; the top box of the stack under the pointer lifts ----
        for (const k of stacks) {
          let s2 = "";
          for (let i = 0; i < k.n; i++) {
            const isTop = i === k.n - 1;
            const z = B + i * 0.82 + (isTop ? k.lift * 0.45 : 0);
            s2 += cbox(P, k.x, k.y, z, 0.8, 0.8, 0.78, isTop && k.lift > 0.5);
            s2 += line([P(k.x - 0.4, k.y, z + 0.78), P(k.x + 0.4, k.y, z + 0.78)], "mid"); // tape
          }
          items.push({ k: k.x + k.y, s: s2 });
        }

        items.sort((a, b) => a.k - b.k);
        return out + items.map((i) => i.s).join("");
      },
    };
  });
}
