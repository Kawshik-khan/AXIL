"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, SendHorizontal, Smartphone, X } from "lucide-react";
import { api } from "@/components/payments/api";
import { ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import stage from "@/app/(auth)/stage.module.css";
import { CATEGORY_LABELS, greeting, PhonePreview, type ChatLine } from "./PhonePreview";
import { PlanStep } from "./PlanStep";
import { StepRail } from "./StepRail";
import styles from "./Onboarding.module.css";
import setup from "./Setup.module.css";

type Step = "welcome" | "shop" | "delivery" | "try" | "plan";
const STEPS: Step[] = ["welcome", "shop", "delivery", "try", "plan"];
const STEP_NAMES: Record<Step, string> = { welcome: "Language", shop: "Your shop", delivery: "Delivery", try: "Try it", plan: "Your plan" };
const STEP_PROMPTS: Record<Step, string> = {
  welcome: "Pick a language",
  shop: "Name and category",
  delivery: "Inside and outside Dhaka",
  try: "Chat as a customer",
  plan: "Choose what fits",
};
const LANGUAGES = [
  { value: "bn", label: "বাংলা", note: "Replies start in Bangla" },
  { value: "en", label: "English", note: "Replies start in English" },
] as const;
const CATEGORIES = ["CLOTHING", "COSMETICS", "FOOD", "GADGETS", "HANDMADE", "OTHER"] as const;

/** What GET/PATCH /api/v1/onboarding return (the parts this flow reads). */
interface OnboardingStatus {
  state: { step: Step; completed_at: string | null } | null;
  needs_onboarding: boolean;
  profile: {
    shop_name: string;
    language: string;
    business_category: string | null;
    delivery_fees: { inside_dhaka_bdt: number; outside_dhaka_bdt: number };
  };
}

/** What customers typically ask, in the mix of Bangla and English they type it in. */
const PROMPTS = ["delivery charge koto? ami Gazipur theke", "COD hobe?", "ki ki product ache?", "return policy ki?"];

const toNumber = (value: string): number | null => {
  const n = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Shop setup for a newly registered workspace (OnboardingService), in three columns: the step rail (StepRail: every
 * step, the answers given so far, finished steps open again), one question at a time, and a phone on the story card
 * showing the shop's chat as the answers come in, with a real test chat with the shop's assistant at the end. Every
 * step saves (PATCH /api/v1/onboarding), so the owner can leave and come back where they stopped.
 */
export function OnboardingFlow() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("welcome");
  const [language, setLanguage] = useState("bn");
  const [shopName, setShopName] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [feeIn, setFeeIn] = useState("");
  const [feeOut, setFeeOut] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const firstField = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement>(null);

  // The preview sheet is a modal <dialog>: open and close it to match the state.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (previewOpen && !sheet.open) sheet.showModal();
    if (!previewOpen && sheet.open) sheet.close();
  }, [previewOpen]);

  // Moving to another step (or to the plan step, which has no preview) closes the sheet.
  useEffect(() => {
    setPreviewOpen(false);
  }, [step]);

  const apply = (status: OnboardingStatus) => {
    setLanguage(status.profile.language === "en" ? "en" : "bn");
    setShopName(status.profile.shop_name);
    setCategory(status.profile.business_category);
    setFeeIn(String(status.profile.delivery_fees.inside_dhaka_bdt));
    setFeeOut(String(status.profile.delivery_fees.outside_dhaka_bdt));
  };

  const load = async () => {
    setLoadError(null);
    const result = await api<OnboardingStatus>("/api/v1/onboarding");
    if (result.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!result.ok || !result.data) {
      setLoadError(result.error?.message ?? "Could not load your shop setup.");
      return;
    }
    // Shops that finished (or never needed) setup go to their dashboard
    if (!result.data.needs_onboarding) {
      window.location.replace("/");
      return;
    }
    apply(result.data);
    setStep(result.data.state?.step ?? "welcome");
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  // Desktop only: on phones, focusing a field on load throws the keyboard over the page
  useEffect(() => {
    if (loaded && window.matchMedia("(min-width: 861px)").matches) firstField.current?.focus();
  }, [step, loaded]);

  /** Saves the answers given and moves to `next`; stays put and shows why when the server refuses. */
  const save = async (patch: Record<string, unknown>, next: Step) => {
    setError(null);
    setSaving(true);
    const result = await api<OnboardingStatus>("/api/v1/onboarding", { method: "PATCH", json: { ...patch, step: next } });
    setSaving(false);
    if (!result.ok || !result.data) {
      setError(result.error?.message ?? "Could not save. Check your connection and try again.");
      return false;
    }
    apply(result.data);
    setStep(next);
    return true;
  };

  const index = STEPS.indexOf(step);
  const go = (offset: number) => {
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, index + offset))];
    void save({}, next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (step === "welcome") await save({ language }, "shop");
    else if (step === "shop") {
      if (shopName.trim().length < 2) return setError("Enter your shop's name (at least 2 characters).");
      await save({ shop_name: shopName.trim(), ...(category ? { business_category: category } : {}) }, "delivery");
    } else if (step === "delivery") {
      const inside = toNumber(feeIn);
      const outside = toNumber(feeOut);
      if (inside === null || outside === null) return setError("Enter both delivery charges in taka (0 or more).");
      await save({ delivery_charge_inside_dhaka: inside, delivery_charge_outside_dhaka: outside }, "try");
    } else if (step === "try") await save({}, "plan");
  };

  /** A real question to the shop's assistant, in simulate mode: nothing is sent to anyone and nothing is saved. */
  const ask = async (text: string) => {
    const message = text.trim();
    if (!message || asking) return;
    setError(null);
    setQuestion("");
    setChat((lines) => [...lines, { from: "customer", text: message }]);
    setAsking(true);
    const result = await api<{ finalResponse: string; status: string }>("/api/v1/ai/simulate", {
      method: "POST",
      json: { message, customer_name: "Test customer", channel_type: "FACEBOOK" },
    });
    setAsking(false);
    if (result.ok && result.data?.finalResponse) {
      setChat((lines) => [...lines, { from: "shop", text: result.data!.finalResponse, source: "Your assistant · test chat" }]);
    } else {
      setError(result.error?.message ?? "Your assistant couldn't answer just now. You can finish setup and try it later.");
    }
  };

  const finish = async (choice: "trial" | "free" | "paid") => {
    const result = await api("/api/v1/onboarding", {
      method: "PATCH",
      json: { step: "plan", complete: true, ...(choice === "free" ? { choose_free_plan: true } : {}) },
    });
    if (!result.ok) throw new Error(result.error?.message ?? "Could not finish setup.");
    // A paid plan needs its first invoice paid: the activation page (it sends a shop that isn't paywalled on to
    // Plan & billing, and one that already has access to its dashboard)
    window.location.href = choice === "paid" ? "/activate" : "/";
  };

  const openStep = (target: string) => {
    const next = STEPS.find((s) => s === target);
    if (next && !saving) void save({}, next);
  };

  if (loadError) {
    return (
      <main className={setup.page}>
        <section className={setup.question} style={{ gridColumn: "1 / -1" }}>
          <ErrorState message={loadError} onRetry={() => void load()} />
        </section>
      </main>
    );
  }

  const name = shopName.trim();
  const inside = toNumber(feeIn);
  const outside = toNumber(feeOut);
  const taka = (n: number | null) => (n === null ? "—" : `৳${n.toLocaleString("en-US")}`);
  const summaries: Record<Step, string> = {
    welcome: language === "bn" ? "বাংলা" : "English",
    shop: name ? `${name}${category ? ` · ${category === "OTHER" ? "Other" : CATEGORY_LABELS[category]}` : ""}` : "Skipped",
    delivery: inside === null && outside === null ? "Skipped" : `${taka(inside)} / ${taka(outside)}`,
    try: chat.length ? `${Math.ceil(chat.length / 2)} test question${chat.length > 2 ? "s" : ""}` : "Done",
    plan: "",
  };
  const railSteps = STEPS.map((s) => ({ id: s, name: STEP_NAMES[s], summary: summaries[s], prompt: STEP_PROMPTS[s] }));

  const renderPreview = (compact = false) => {
    if (step === "welcome") return <PhonePreview compact={compact} shopName="" category={null} lines={[]} waiting tag="Waiting to learn your shop" />;
    const hello: ChatLine = { from: "shop", text: greeting(name, language) };
    if (step === "shop") {
      return (
        <PhonePreview compact={compact}
          shopName={name}
          category={category}
          lines={[hello]}
          tag="Learning your shop"
          learned={{ left: name ? "Learned your shop name" : undefined, right: category ? `${CATEGORY_LABELS[category]} shop` : undefined }}
        />
      );
    }
    if (step === "delivery") {
      const lines: ChatLine[] = [hello, { from: "customer", text: "delivery charge koto? ami Gazipur theke" }];
      if (outside !== null) {
        lines.push({
          from: "shop",
          text: `Gazipur is outside Dhaka, so delivery is ৳${outside.toLocaleString("en-US")}.`,
          source: "Example · from your delivery charges",
        });
      }
      return <PhonePreview compact={compact} shopName={name} category={category} lines={lines} tag="Learning delivery" learned={{ left: outside !== null ? "Learned delivery charges" : undefined }} />;
    }
    return <PhonePreview compact={compact} shopName={name} category={category} lines={[hello, ...chat]} typing={asking} tag="Ready · test chat" ready />;
  };

  return (
    <main className={setup.page}>
      <StepRail
        steps={railSteps}
        current={loaded ? index : 0}
        onOpen={openStep}
        disabled={saving || !loaded}
        laterLabel={step === "plan" ? "Decide later" : "Save & finish later"}
      />

      {!loaded ? (
        <section className={`${setup.question} ${setup.wide}`}>
          <LoadingSkeleton lines={6} />
        </section>
      ) : step === "plan" ? (
        <section className={`${setup.question} ${setup.wide}`}>
          <PlanStep onDone={finish} onBack={() => go(-1)} />
        </section>
      ) : (
        <>
          <section className={setup.question}>
            {/* narrow screens only (CSS): the phone column is hidden there, so it opens in a sheet instead */}
            <button type="button" className={setup.peek} onClick={() => setPreviewOpen(true)} aria-haspopup="dialog">
              <Smartphone size={18} aria-hidden="true" />
              See what customers see
            </button>
            <form className={setup.form} onSubmit={(e) => void submit(e)} noValidate>
              <div className={setup.body}>
                <div key={step} className={setup.inner}>
                  {step === "welcome" && (
                    <>
                      <h2 className={setup.heading}>
                        Let&apos;s open your <span className={setup.hl}>shop</span>.
                      </h2>
                      <p className={setup.lead}>Five quick steps. Your AI assistant learns each answer, and the phone shows the chat your customers will get.</p>
                      <fieldset className={setup.choices}>
                        <legend>Which language should your assistant start in?</legend>
                        {LANGUAGES.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={language === option.value}
                            className={`${setup.option} ${language === option.value ? setup.optionOn : ""}`}
                            onClick={() => setLanguage(option.value)}
                          >
                            <span className={setup.dot} aria-hidden="true" />
                            <span className={setup.optionText}>
                              <strong>{option.label}</strong>
                              <small>{option.note}</small>
                            </span>
                          </button>
                        ))}
                      </fieldset>
                    </>
                  )}

                  {step === "shop" && (
                    <>
                      <h2 className={setup.heading}>
                        What&apos;s your <span className={setup.hl}>shop</span> called?
                      </h2>
                      <p className={setup.lead}>Customers see this name in every chat.</p>
                      <div className={stage.field}>
                        <label htmlFor="ob-shop-name">Shop name</label>
                        <input
                          id="ob-shop-name"
                          ref={firstField}
                          value={shopName}
                          onChange={(e) => setShopName(e.target.value)}
                          maxLength={120}
                          autoComplete="organization"
                          placeholder="e.g. Dhaka Artisan Silk"
                          required
                        />
                      </div>
                      <fieldset className={styles.fieldset}>
                        <legend>What do you sell?</legend>
                        <div className={styles.chips}>
                          {CATEGORIES.map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-pressed={category === c}
                              className={`${styles.chip} ${category === c ? styles.chipOn : ""}`}
                              onClick={() => setCategory(c)}
                            >
                              {c === "OTHER" ? "Something else" : CATEGORY_LABELS[c]}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}

                  {step === "delivery" && (
                    <>
                      <h2 className={setup.heading}>
                        What do you charge for <span className={setup.hl}>delivery</span>?
                      </h2>
                      <p className={setup.lead}>Added to every order and quoted by your assistant. The customer&apos;s district decides which one applies.</p>
                      <div className={styles.feeRow}>
                        <div className={styles.fee}>
                          <label htmlFor="ob-fee-in">Inside Dhaka</label>
                          <div className={styles.feeBox}>
                            <span className={styles.taka} aria-hidden="true">
                              ৳
                            </span>
                            <input id="ob-fee-in" ref={firstField} inputMode="numeric" value={feeIn} onChange={(e) => setFeeIn(e.target.value)} />
                          </div>
                          <span className={styles.feeHint}>Dhaka city</span>
                        </div>
                        <div className={styles.fee}>
                          <label htmlFor="ob-fee-out">Outside Dhaka</label>
                          <div className={styles.feeBox}>
                            <span className={styles.taka} aria-hidden="true">
                              ৳
                            </span>
                            <input id="ob-fee-out" inputMode="numeric" value={feeOut} onChange={(e) => setFeeOut(e.target.value)} />
                          </div>
                          <span className={styles.feeHint}>The other 62 districts</span>
                        </div>
                      </div>
                    </>
                  )}

                  {step === "try" && (
                    <>
                      <h2 className={setup.heading}>
                        Your assistant is <span className={setup.hl}>ready</span>.
                      </h2>
                      <p className={setup.lead}>Ask what your buyers ask. These are real answers from your assistant, as a test: nothing is sent to anyone.</p>
                      <div className={styles.prompts}>
                        {PROMPTS.map((p) => (
                          <button key={p} type="button" className={styles.prompt} disabled={asking} onClick={() => void ask(p)}>
                            {p}
                          </button>
                        ))}
                      </div>
                      <div className={styles.askRow}>
                        <input
                          ref={firstField}
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void ask(question);
                            }
                          }}
                          placeholder="Or type your own question"
                          aria-label="Ask your assistant"
                        />
                        <button type="button" onClick={() => void ask(question)} disabled={asking || !question.trim()} aria-label="Send">
                          <SendHorizontal size={18} />
                        </button>
                      </div>
                    </>
                  )}

                  {error && (
                    <p className={stage.alert} role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </div>

              <div className={setup.actions}>
                <div className={setup.actionsLeft}>
                  {index > 0 && (
                    <button type="button" className={setup.round} onClick={() => go(-1)} disabled={saving} aria-label="Previous step">
                      <ArrowLeft size={20} />
                    </button>
                  )}
                  {step !== "welcome" && (
                    <button type="button" className={setup.skip} onClick={() => go(1)} disabled={saving}>
                      Skip this step
                    </button>
                  )}
                </div>
                <button type="submit" className={setup.continue} disabled={saving}>
                  {saving ? "Saving…" : step === "welcome" ? "Start setting up" : step === "try" ? "Continue to your plan" : "Continue"}
                  {!saving && <ArrowRight size={18} />}
                </button>
              </div>
            </form>
          </section>

          <aside className={setup.story}>
            <i className={`${setup.glow} ${setup.glowA} ${step === "try" ? setup.glowReady : ""}`} aria-hidden="true" />
            <i className={`${setup.glow} ${setup.glowB}`} aria-hidden="true" />
            {renderPreview()}
          </aside>

          {/* The native dialog keeps focus inside, closes on Escape and returns focus to the button */}
          <dialog
            ref={sheetRef}
            className={setup.sheet}
            aria-labelledby="ob-sheet-title"
            onClose={() => setPreviewOpen(false)}
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewOpen(false);
            }}
          >
            <div className={setup.sheetBody}>
              <div className={setup.sheetHead}>
                <h2 id="ob-sheet-title">What customers see</h2>
                <button type="button" className={setup.sheetClose} onClick={() => setPreviewOpen(false)} aria-label="Close preview">
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              {previewOpen && renderPreview(true)}
            </div>
          </dialog>
        </>
      )}
    </main>
  );
}
