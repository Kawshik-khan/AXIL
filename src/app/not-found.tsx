import React from "react";
import Link from "next/link";
import { AlertTriangle, Home, MessageSquare } from "lucide-react";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F8F9F6",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(30, 32, 30, 0.08)",
          borderRadius: "24px",
          padding: "48px 36px",
          maxWidth: "480px",
          width: "100%",
          textAlign: "center",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.06)",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "16px",
            background: "rgba(199, 249, 0, 0.2)",
            border: "1.5px solid #C7F900",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <AlertTriangle size={28} color="#242529" />
        </div>

        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "#1F2937",
            letterSpacing: "-0.02em",
            marginBottom: "8px",
          }}
        >
          404 — Page Not Found
        </h1>

        <p
          style={{
            fontSize: "0.875rem",
            color: "#6B7280",
            lineHeight: 1.5,
            marginBottom: "28px",
          }}
        >
          The page or resource you are looking for does not exist or has been moved.
        </p>

        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "center",
          }}
        >
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 18px",
              borderRadius: "12px",
              background: "#242529",
              color: "#FFFFFF",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
          >
            <Home size={15} />
            <span>Dashboard</span>
          </Link>

          <Link
            href="/conversations"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 18px",
              borderRadius: "12px",
              background: "#C7F900",
              color: "#121316",
              fontSize: "0.875rem",
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 2px 8px rgba(199, 249, 0, 0.3)",
              transition: "all 0.15s ease",
            }}
          >
            <MessageSquare size={15} />
            <span>Unified Inbox</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
