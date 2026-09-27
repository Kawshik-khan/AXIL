/**
 * Script to test Live TypeSafe AI Jev Connection
 */

import { JevClient, jevClient } from "../src/domains/ai/providers/jev";

async function main() {
  console.log("==================================================");
  console.log("   TESTING LIVE TYPESAFE AI JEV CONNECTION       ");
  console.log("==================================================");

  const rawKey = process.env.TYPESAFE_API_KEY || "";
  const rawUrl = process.env.TYPESAFE_API_URL || "https://api.typesafe.ai/v1";

  console.log(`TYPESAFE_API_URL: ${rawUrl}`);
  console.log(`TYPESAFE_API_KEY detected: ${rawKey ? "YES (length: " + rawKey.trim().length + ")" : "NO"}`);

  // Test 1: Direct Fetch to TypeSafe AI endpoint
  const trimmedKey = rawKey.trim();
  const trimmedUrl = rawUrl.trim();

  // TypeSafe AI official System One payload format
  const testPayload = {
    model: "jev-latest",
    state: "Hi, I have a delivery issue with my order COM-9812, please help urgently!",
    questions: {
      is_urgent: {
        type: "noul",
        instructions: "The message conveys urgency or time-sensitivity",
      },
      target_department: {
        type: "choice",
        instructions: "Which department should handle this?",
        criteria: {
          SUPPORT: "Customer support for order and delivery issues",
          SALES: "Sales inquiries and product advice",
          BILLING: "Payment, refunds, and invoice inquiries",
        },
      },
      severity: {
        type: "score",
        instructions: "Rate the severity of the issue",
        criteria: [
          "Low: Minor question, no rush",
          "Medium: Standard delay or issue",
          "High: Critical, angry customer or missing package",
        ],
      },
    },
  };

  console.log("\n[1] Testing direct HTTP POST to TypeSafe AI...");
  
  // Candidate endpoints to test
  const base = trimmedUrl.replace(/\/+$/, "");
  const candidateEndpoints = [
    base.endsWith("/systemone") ? base : `${base}/systemone`,
    base.endsWith("/decide") ? base : `${base}/decide`,
    base,
  ];

  let directSuccess = false;
  for (const endpoint of candidateEndpoints) {
    try {
      console.log(`Trying endpoint: ${endpoint} ...`);
      const startTime = Date.now();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${trimmedKey}`,
        },
        body: JSON.stringify(testPayload),
      });

      console.log(`Status: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.log(`Response preview: ${text.slice(0, 300)}`);

      if (res.ok) {
        console.log(`\n✓ SUCCESS with endpoint: ${endpoint} in ${Date.now() - startTime}ms`);
        directSuccess = true;
        break;
      }
    } catch (err: unknown) {
      console.log(`Request to ${endpoint} failed: ${String(err)}`);
    }
  }

  // Test 2: Via CommerceOS JevClient (mockMode disabled to test live)
  console.log("\n[2] Testing CommerceOS JevClient with live mode enabled...");
  jevClient.setMockMode(false);

  try {
    const startTime = Date.now();
    const result = await jevClient.evaluate("ten_live_test", testPayload);
    console.log(`✓ JevClient.evaluate() SUCCESS in ${Date.now() - startTime}ms!`);
    console.log("Evaluation Results:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    console.error("JevClient live evaluation error:", err);
  }
}

main().catch(console.error);
