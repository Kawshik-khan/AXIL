"use client";

import { useEffect, useRef } from "react";
import type { FigureMount, FigureOptions } from "./commerce-figures";

interface FigureProps {
  /** A Hairline figure (`terrain`, `basket`, ...) or one of the CommerceOS figures. Pass a module-level function. */
  mount: FigureMount;
  /** Initial options. Later changes are not applied: the figure is mounted once. */
  options?: FigureOptions;
  /** The accessible name. */
  label: string;
  className?: string;
}

/**
 * Mounts one figure into an empty box and tears it down on unmount. The box reserves a 5:4 space on the
 * server (see `.fig` in landing.module.css), so the layout does not shift when the figure appears.
 */
export function Figure({ mount, options, label, className }: FigureProps) {
  const box = useRef<HTMLDivElement>(null);
  const initial = useRef(options);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const figure = mount(el, { ...initial.current, label });
    return () => figure.destroy();
  }, [mount, label]);

  return <div ref={box} className={className} />;
}
