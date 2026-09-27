"use client";

import React, { useState, useEffect } from "react";
import { Send, MessageSquare, User, Phone, Globe, CheckCircle2, RotateCw } from "lucide-react";
import styles from "./SocialInbox.module.css";

interface WidgetMessage {
  id: string;
  sender: "visitor" | "agent";
  text: string;
  timestamp: string;
}

interface WebsiteChatWidgetProps {
  channelId?: string;
  onNewMessageSent?: () => void;
}

export const WebsiteChatWidget: React.FC<WebsiteChatWidgetProps> = ({
  channelId = "chn_dhaka_webchat_01",
  onNewMessageSent,
}) => {
  const [anonymousId] = useState(() => `anon_vis_${Math.random().toString(36).slice(2, 8)}`);
  const [visitorName, setVisitorName] = useState("Tanvir Rahman");
  const [visitorPhone, setVisitorPhone] = useState("01711223344");
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>([
    {
      id: "init_1",
      sender: "agent",
      text: "Assalamu Alaikum! Welcome to our store. How can we assist you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const samplePrompts = [
    "Aapnader premium silk panjabi er price koto?",
    "Dhaka er baire delivery charge koto?",
    "Ami 1 piece black panjabi order korte chai, phone: 01711223344",
  ];

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isSending) return;

    const userMsg: WidgetMessage = {
      id: `vis_${Date.now()}`,
      sender: "visitor",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText("");
    setIsSending(true);
    setStatusMsg("Sending to CommerceOS Ingress...");

    try {
      const res = await fetch("/api/v1/social/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channelId,
          anonymous_id: anonymousId,
          customer_name: visitorName,
          phone: visitorPhone,
          text,
          page_url: typeof window !== "undefined" ? window.location.href : "https://store.bangla-threads.com/products/panjabi",
        }),
      });

      if (res.ok) {
        setStatusMsg("Delivered to Unified Inbox ✓");
        setTimeout(() => setStatusMsg(null), 3000);
        if (onNewMessageSent) onNewMessageSent();
      } else {
        const data = await res.json();
        setStatusMsg(`Failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      setStatusMsg("Delivery error (check network)");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={styles.widgetSimulatorCard}>
      <div>
        <h3 style={{ margin: "0 0 6px 0", fontSize: "1.125rem", color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
          <MessageSquare size={20} color="var(--color-primary)" /> First-Party Website Live Chat Simulator
        </h3>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Simulates an end customer interacting with your storefront live chat widget. Messages arrive in the CommerceOS Unified Inbox in real time.
        </p>
      </div>

      {/* Visitor Profile Bar */}
      <div style={{ background: "#1c1e22", padding: "14px", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>
          Visitor Identity Simulation
        </div>
        <div className={styles.widgetVisitorMeta}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#141518", padding: "6px 10px", borderRadius: "var(--radius-sm)", border: "1px solid #2e3036" }}>
            <User size={14} color="var(--color-text-muted)" />
            <input
              type="text"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              placeholder="Visitor Name"
              style={{ background: "transparent", border: "none", color: "#fff", fontSize: "0.75rem", outline: "none", width: "100%" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#141518", padding: "6px 10px", borderRadius: "var(--radius-sm)", border: "1px solid #2e3036" }}>
            <Phone size={14} color="var(--color-text-muted)" />
            <input
              type="text"
              value={visitorPhone}
              onChange={(e) => setVisitorPhone(e.target.value)}
              placeholder="Visitor Phone (BD)"
              style={{ background: "transparent", border: "none", color: "#fff", fontSize: "0.75rem", outline: "none", width: "100%" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
          <Globe size={12} /> ID: <code>{anonymousId}</code> • Channel: <code>{channelId}</code>
        </div>
      </div>

      {/* Suggested Banglish Quick Prompts */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", fontWeight: 600 }}>Try Bangladeshi F-Commerce / E-Commerce Scenarios:</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {samplePrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendMessage(prompt)}
              disabled={isSending}
              style={{
                background: "#24262c",
                border: "1px solid #33363e",
                color: "#e1e3e8",
                fontSize: "0.75rem",
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Live Chat Frame */}
      <div className={styles.widgetPreviewContainer}>
        {/* Header */}
        <div className={styles.widgetHeader}>
          <div className={styles.widgetBrand}>
            <div className={styles.widgetAvatar}>BD</div>
            <div>
              <div className={styles.widgetBrandTitle}>Bangla Threads Customer Support</div>
              <div className={styles.widgetBrandStatus}>
                <span className={styles.widgetStatusDot}></span> Agents Online • Typically replies in 2 mins
              </div>
            </div>
          </div>
          {statusMsg && (
            <div style={{ fontSize: "0.6875rem", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
              <CheckCircle2 size={12} /> {statusMsg}
            </div>
          )}
        </div>

        {/* Message Thread */}
        <div className={styles.widgetBody}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.sender === "visitor" ? styles.widgetVisitorBubble : styles.widgetAgentBubble}
            >
              <div>{m.text}</div>
              <div style={{ fontSize: "0.625rem", opacity: 0.7, marginTop: "4px", textAlign: m.sender === "visitor" ? "right" : "left" }}>
                {m.timestamp}
              </div>
            </div>
          ))}
          {isSending && (
            <div className={styles.widgetVisitorBubble} style={{ opacity: 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <RotateCw size={12} className="spin" /> Sending...
              </div>
            </div>
          )}
        </div>

        {/* Input Footer */}
        <form
          className={styles.widgetFooter}
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
        >
          <input
            type="text"
            className={styles.widgetInput}
            placeholder="Type your message in English or Banglish..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isSending}
          />
          <button
            type="submit"
            className={styles.widgetSendBtn}
            disabled={!inputText.trim() || isSending}
            title="Send"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};
