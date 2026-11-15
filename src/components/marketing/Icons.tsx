/** Small stroke icons used across the landing page. Colours come from `currentColor`. */
import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 20, className, children, fill = "none" }: IconProps & { children: ReactNode; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={fill === "none" ? "currentColor" : "none"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

export const Icon = {
  check: (p: IconProps) => <Svg {...p}><path d="M5 12l5 5 9-10" /></Svg>,
  chat: (p: IconProps) => <Svg {...p}><path d="M4 5h16v11H9l-5 4z" /></Svg>,
  box: (p: IconProps) => <Svg {...p}><path d="M3 8l9-5 9 5-9 5z" /><path d="M3 8v8l9 5 9-5V8" /></Svg>,
  bag: (p: IconProps) => <Svg {...p}><path d="M6 7h12l-1 13H7z" /><path d="M9 7a3 3 0 016 0" /></Svg>,
  trend: (p: IconProps) => <Svg {...p}><path d="M4 19l6-6 4 4 6-8" /><path d="M15 9h5v5" /></Svg>,
  share: (p: IconProps) => <Svg {...p}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 11l7.6-4M8.2 13l7.6 4" /></Svg>,
  truck: (p: IconProps) => <Svg {...p}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></Svg>,
  card: (p: IconProps) => <Svg {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></Svg>,
  megaphone: (p: IconProps) => <Svg {...p}><path d="M4 10v4l11 5V5z" /><path d="M18 9a4 4 0 010 6" /></Svg>,
  bars: (p: IconProps) => <Svg {...p}><path d="M5 20V10M12 20V4M19 20v-7" /></Svg>,
  tag: (p: IconProps) => <Svg {...p}><path d="M20 12l-8 8-8-8V4h8z" /><circle cx="8.5" cy="8.5" r="1.5" /></Svg>,
  taka: (p: IconProps) => <Svg {...p}><path d="M12 3v18M16 7H10a3 3 0 000 6h4a3 3 0 010 6H7" /></Svg>,
  search: (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></Svg>,
  clock: (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></Svg>,
  send: (p: IconProps) => <Svg {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></Svg>,
  plus: (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  arrow: (p: IconProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>,
  sparkle: (p: IconProps) => <Svg {...p} fill="currentColor"><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" /></Svg>,
  star: (p: IconProps) => <Svg {...p} fill="currentColor"><path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z" /></Svg>,
  shield: (p: IconProps) => <Svg {...p}><path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z" /><path d="M9 12l2 2 4-4" /></Svg>,
} as const;

export type IconName = keyof typeof Icon;
