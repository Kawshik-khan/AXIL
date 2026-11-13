"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/Button/Button";
import { LoadingSkeleton } from "@/components/ui/States/States";
import { api } from "@/components/payments/api";
import styles from "@/components/payments/Payments.module.css";

/**
 * bKash sends the payer's browser here after its checkout page (?paymentID=…&status=success|failure|cancel). This page
 * only hands those to the server, which asks bKash itself whether the payment completed, and then goes to the page
 * that shows the real state (the pay page or the billing page). A page, not an API route, because bKash arrives with
 * a GET and a GET must never write.
 */
export default function BkashReturnPage() {
  const params = useParams<{ attempt: string }>();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // one confirmation per visit, also under React strict mode
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    void api<{ redirect_path: string }>("/api/v1/payments/gateway/bkash/confirm", {
      method: "POST",
      json: {
        attempt_id: params.attempt,
        ...(query.get("paymentID") ? { payment_id: query.get("paymentID") } : {}),
        ...(query.get("status") ? { status: query.get("status") } : {}),
      },
    }).then((result) => {
      const path = result.data?.redirect_path;
      // Only ever a path on this site, built by the server from its own records
      if (result.ok && path && path.startsWith("/") && !path.startsWith("//")) {
        window.location.replace(path);
        return;
      }
      setError(result.error?.message ?? "We could not confirm this payment.");
    });
  }, [params.attempt]);

  return (
    <main className={styles.publicShell}>
      <div className={styles.publicCard} role={error ? "alert" : "status"}>
        {error ? (
          <>
            <h1 className={styles.sectionTitle}>We could not confirm this payment</h1>
            <p className={styles.publicMeta}>
              {error} If money left your bKash account, do not pay again: it will be matched once bKash confirms it.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Check again
            </Button>
          </>
        ) : (
          <>
            <h1 className={styles.sectionTitle}>Confirming your bKash payment</h1>
            <p className={styles.publicMeta}>Please keep this page open for a moment.</p>
            <LoadingSkeleton lines={2} inline />
          </>
        )}
      </div>
    </main>
  );
}
