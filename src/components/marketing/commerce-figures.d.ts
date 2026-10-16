/** Options shared by every CommerceOS figure (the same shape Hairline's own figures take). */
export interface FigureOptions {
  /** How strongly the figure answers the pointer, 0 to 1. Default 0.5. */
  intensity?: number;
  /** "auto" follows an ancestor with class `dark` / `data-theme="dark"`, then the page's color scheme. */
  theme?: "auto" | "light" | "dark";
  /** The accessible name. */
  label?: string;
  /** The figure's caption, each time it changes. */
  onRead?: (text: string) => void;
  /** Plays on its own until the pointer or focus arrives. */
  play?: boolean;
  /** `channels` only: keep the flow running even after the pointer has visited. */
  ambient?: boolean;
  /** `shopfront` only: the sign-in state the shop shows. Default "locked". */
  state?: "locked" | "checking" | "unlocked";
}

export interface FigureHandle {
  update(options: FigureOptions): void;
  destroy(): void;
}

export type FigureMount = (element: HTMLElement, options?: FigureOptions) => FigureHandle;

/** Messages from every channel stream into one hub that turns them into orders. */
export const channels: FigureMount;
/** An order becomes a parcel along a belt; the pointer scrubs it forward and back. */
export const pipeline: FigureMount;
/** Parcels wait at a barrier until a person approves. */
export const gate: FigureMount;
/** Delivery zones around a warehouse; the zone under the pointer lifts. */
export const zones: FigureMount;
/** A grid cube whose cells light up (lime) under the pointer and leave a fading trail. */
export const lattice: FigureMount;
/** A shop with its rolling shutter padlocked shut; `state: "unlocked"` opens the lock and rolls the shutter up. */
export const shopfront: FigureMount;
