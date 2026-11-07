/**
 * Tap choices in chat (reply blocks, Phase 1): after the shop overview the categories go out as their own message of
 * buttons instead of a text list. The options are the merchant's own categories from the tool result, never model
 * text. A tap comes back as the customer's message "Category: <value>" (see CHOICE_TAP_LABELS), so the agent handles it
 * like any message (search_products with that category) and the confirmation gate never reads it as a yes.
 *
 * Kept free of the catalog and the store so the channel adapters and the widget can import it.
 *
 * Each channel's limits decide whether the choices fit: a set that doesn't fit isn't sent as buttons, and the agent
 * lists the categories in its reply instead (choicesFit, used by the tool's note and by the worker).
 */
import type { ChannelType, ChoiceOption, ChoiceSet } from "@/types/social";
import type { ToolResult } from "@/domains/ai/customer-agent/tools";
import { MAX_CHOICE_OPTIONS } from "@/lib/choice-shape";

export { MAX_CHOICE_OPTIONS };

/** What the channel can draw: Messenger/Instagram quick replies (13), a WhatsApp list (10 rows), our own buttons. */
const CHANNEL_MAX_OPTIONS: Partial<Record<ChannelType, number>> = {
  TELEGRAM: MAX_CHOICE_OPTIONS,
  FACEBOOK_MESSENGER: 13,
  INSTAGRAM: 13,
  WHATSAPP: 10,
  WEBSITE_CHAT: MAX_CHOICE_OPTIONS,
};

/** Whether `count` options go out as buttons on this channel. Fewer than two is no choice. */
export function choicesFit(channel: ChannelType, count: number): boolean {
  const max = CHANNEL_MAX_OPTIONS[channel];
  return Boolean(max) && count >= 2 && count <= max!;
}

const PROMPTS = {
  category: { bangla: "ক্যাটাগরি বেছে নিন:", latin: "Category bechhe nin:" },
} as const;

const WHATSAPP_LIST_BUTTON = { bangla: "ক্যাটাগরি দেখুন", latin: "Category dekhun" } as const;
const WHATSAPP_SECTION = { bangla: "ক্যাটাগরি", latin: "Categories" } as const;

/** A value as one clean line: control characters, line separators and "|" (our payload separator) removed, capped. */
const cleanValue = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}|]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** The categories a shop overview (search_products' `view: "categories"`) listed, or null when there is no choice. */
export function categoryChoicesFromToolResults(results: readonly ToolResult[], script: "bangla" | "latin"): ChoiceSet | null {
  const overview = results.find((r) => r.view === "categories" && Array.isArray(r.categories_untrusted));
  const options: ChoiceOption[] = [];
  for (const raw of (overview?.categories_untrusted ?? []) as unknown[]) {
    const c = raw as { name?: unknown; products?: unknown };
    const value = typeof c.name === "string" ? cleanValue(c.name) : "";
    if (!value || typeof c.products !== "number" || c.products <= 0 || options.some((o) => o.value === value)) continue;
    options.push({ value, count: c.products });
  }
  if (options.length < 2) return null;
  return { kind: "category", prompt: PROMPTS.category[script], options: options.slice(0, MAX_CHOICE_OPTIONS), script };
}

/** The plain-text form kept on the message (staff inbox, search, a channel that can't draw buttons). */
export function choicesText(set: ChoiceSet): string {
  return `${set.prompt}\n${set.options.map((o) => `- ${optionLabel(o)}`).join("\n")}`;
}

/** "Panjabi (10)": the value and its count. */
export function optionLabel(o: ChoiceOption): string {
  return typeof o.count === "number" ? `${o.value} (${o.count})` : o.value;
}

// ---- Tap payloads ------------------------------------------------------------------------------------------------------

/**
 * A tap arrives as "<fixed label>: <value>", e.g. "Category: Panjabi", like a product-card tap ("Order now: …"). The label
 * is how the confirmation gate knows a tap is browsing: a category named "Sure Fit" must never be the "yes" that places
 * a quoted order when an old button is tapped. The label follows the script carried in the payload.
 */
export const CHOICE_TAP_LABELS = { bangla: "ক্যাটাগরি", latin: "Category" } as const;

export function choiceTapMessage(value: string, script: "bangla" | "latin"): string {
  return `${CHOICE_TAP_LABELS[script]}: ${value}`;
}

/** Whether a message is a choice tap ("<one of our labels>: …"), on any channel including the website widget. */
export function isChoiceTapText(text: string): boolean {
  const t = text.normalize("NFC").trim();
  return Object.values(CHOICE_TAP_LABELS).some((label) => t.startsWith(`${label}:`));
}

/** The value of a choice tap ("Category: Panjabi" → "Panjabi"), or the text unchanged when it isn't one. */
export function stripChoiceTapLabel(text: string): string {
  const t = text.normalize("NFC").trim();
  const label = Object.values(CHOICE_TAP_LABELS).find((l) => t.startsWith(`${l}:`));
  return label ? t.slice(label.length + 1).trim() : text;
}

/**
 * Messenger/Instagram quick-reply payload and WhatsApp list row id: `CHOICE|<value>|<bn|en>` (values carry no "|").
 * One stored without the script segment reads as latin.
 */
export const CHOICE_PREFIX = "CHOICE";

export function choicePayload(value: string, script: "bangla" | "latin"): string {
  return `${CHOICE_PREFIX}|${value}|${script === "bangla" ? "bn" : "en"}`;
}

/** The customer message a tap becomes, from a payload we wrote, or null when it isn't ours. */
export function choiceTapText(payload: string | undefined): string | null {
  if (!payload || !payload.startsWith(`${CHOICE_PREFIX}|`)) return null;
  const [, rawValue, script, ...rest] = payload.split("|");
  if (rest.length || (script !== undefined && script !== "bn" && script !== "en")) return null;
  const value = cleanValue(rawValue ?? "");
  return value ? choiceTapMessage(value, script === "bn" ? "bangla" : "latin") : null;
}

/**
 * Telegram button data, `PC|<index>|<b|e>`: a name may be too long for 64 bytes, so a press reads the button's own
 * text. Buttons sent before the script segment existed (`PC|<index>`) read as latin.
 */
const TELEGRAM_CHOICE_PREFIX = "PC";

type InlineKeyboard = { inline_keyboard?: Array<Array<{ text?: unknown; callback_data?: unknown }>> };

/**
 * The customer message a Telegram choice press becomes, read from the pressed button on the message we sent (our
 * count suffix removed). Null when the data isn't a choice button or the button can't be found.
 */
export function telegramChoiceTapText(data: string | undefined, markup: InlineKeyboard | undefined): string | null {
  const match = data ? new RegExp(`^${TELEGRAM_CHOICE_PREFIX}\\|\\d{1,2}(?:\\|([be]))?$`).exec(data) : null;
  if (!match) return null;
  const button = (markup?.inline_keyboard ?? []).flat().find((b) => b?.callback_data === data);
  if (typeof button?.text !== "string") return null;
  const value = cleanValue(button.text.replace(/\s\(\d+\)$/, ""));
  return value ? choiceTapMessage(value, match[1] === "b" ? "bangla" : "latin") : null;
}

// ---- Channel formats ---------------------------------------------------------------------------------------------------

/** Telegram sendMessage: the prompt with an inline keyboard, two buttons per row. */
export function telegramChoicesMessage(set: ChoiceSet, chatId: string): Record<string, unknown> {
  const s = set.script === "bangla" ? "b" : "e";
  const buttons = set.options.slice(0, MAX_CHOICE_OPTIONS).map((o, i) => ({ text: optionLabel(o), callback_data: `${TELEGRAM_CHOICE_PREFIX}|${i}|${s}` }));
  const rows: (typeof buttons)[] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { chat_id: chatId, text: set.prompt, reply_markup: { inline_keyboard: rows } };
}

/**
 * Messenger/Instagram message with quick replies (at most 13, titles at most 20 characters). The count is left out
 * when the title would be cut; the payload carries the full value, so a cut title still sends the whole name.
 */
export function metaQuickRepliesMessage(set: ChoiceSet): Record<string, unknown> {
  return {
    text: set.prompt,
    quick_replies: set.options.slice(0, 13).map((o) => {
      const label = optionLabel(o);
      return { content_type: "text", title: (label.length <= 20 ? label : o.value).slice(0, 20), payload: choicePayload(o.value, set.script) };
    }),
  };
}

/** WhatsApp interactive list (at most 10 rows; a title at most 24 characters, the count as the row's description). */
export function whatsappChoicesMessage(set: ChoiceSet, to: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: set.prompt.slice(0, 1024) },
      action: {
        button: WHATSAPP_LIST_BUTTON[set.script],
        sections: [
          {
            title: WHATSAPP_SECTION[set.script],
            rows: set.options.slice(0, 10).map((o) => ({
              id: choicePayload(o.value, set.script), // at most 76 characters: values are capped at 60
              title: o.value.slice(0, 24),
              ...(typeof o.count === "number" ? { description: set.script === "bangla" ? `${o.count}টি প্রোডাক্ট` : `${o.count} ta product` } : {}),
            })),
          },
        ],
      },
    },
  };
}
