import React from "react";
import { Bot, ClipboardCheck, Gauge, Headset, Inbox, Power, ShieldAlert, Siren } from "lucide-react";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";

const ICONS: Record<AttentionItem["category"], typeof Bot> = {
  INCIDENT: Siren,
  KILL_SWITCH: Power,
  LIMIT: Gauge,
  DEAD_LETTER: Inbox,
  HITL: Bot,
  APPROVAL: ClipboardCheck,
  SECURITY: ShieldAlert,
  SUPPORT: Headset,
};

export const CategoryIcon: React.FC<{ category: AttentionItem["category"] }> = ({ category }) => {
  const Icon = ICONS[category];
  return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />;
};
