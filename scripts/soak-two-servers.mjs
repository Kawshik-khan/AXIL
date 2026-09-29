/**
 * Two-server soak test (FIX_IMPLEMENTATION_PLAN FX-45, ADR-109): proves no acknowledged write is lost and both servers
 * agree, while workers write the same records through both servers at once.
 *
 *   SOAK_URL_A=http://localhost:3101 SOAK_URL_B=http://localhost:3102 [SOAK_MINUTES=10] [SOAK_WORKERS=8] \
 *     node scripts/soak-two-servers.mjs
 *
 * Both servers must use the same database (DATA_BACKEND=pg) and the same JWT_SECRET. The script registers a throwaway
 * workspace (sign-up is rate-limited: once per run), creates one product, then until the deadline each worker, on
 * alternating servers:
 *   - adds 1 unit of stock to the shared product (retrying on 409) — every 200 is an acknowledged increment;
 *   - places an order for 1 unit (reserves stock) — every 201 is an acknowledged reservation;
 *   - reads orders and inventory.
 * At the end, within SOAK_CONVERGE_MS (35 s, the read staleness limit): stock on hand must equal the acknowledged
 * increments and reserved stock the acknowledged orders, on both servers; the order count must match. Retried 409 / 503
 * responses (the store saved nothing) are counted, never failures. Prints PASS/FAIL (exit code 0/1). Never prints credentials.
 */
import crypto from "crypto";

const A = process.env.SOAK_URL_A;
const B = process.env.SOAK_URL_B;
if (!A || !B) {
  process.stderr.write("Set SOAK_URL_A and SOAK_URL_B.\n");
  process.exit(1);
}
const minutes = Number(process.env.SOAK_MINUTES || 10);
const workers = Number(process.env.SOAK_WORKERS || 8);
/** Both servers must show every acknowledged write within this long (ADR-109: reads may lag up to STORE_MAX_STALENESS_MS). */
const convergeMs = Number(process.env.SOAK_CONVERGE_MS || 35_000);
const out = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Uniform in [0, 1): picks operations and retry jitter (not ids or secrets). */
const chance = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

const stats = { adjust_ok: 0, order_ok: 0, read_ok: 0, conflict_409: 0, busy_503: 0, retries_exhausted: 0, errors: {} };
const bump = (code) => (stats.errors[code] = (stats.errors[code] || 0) + 1);

async function call(base, method, route, { cookie, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, json, cookies: res.headers.getSetCookie?.() ?? [] };
}

/** Retries what the store asks clients to retry: 409 STORE_CONFLICT and 503 STORE_BUSY (both saved nothing). */
async function withRetry(fn) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await fn();
    const code = r.json?.error?.code;
    if (r.status === 409 && code === "STORE_CONFLICT") {
      stats.conflict_409++;
      await sleep(20 + chance() * 80);
    } else if (r.status === 503 && code === "STORE_BUSY") {
      stats.busy_503++;
      await sleep(500 + chance() * 1500);
    } else return r;
  }
  stats.retries_exhausted++;
  return { status: 409 };
}

async function inventoryOf(base, cookie, variantId) {
  const r = await call(base, "GET", "/api/v1/inventory", { cookie });
  const list = r.json?.data?.inventory ?? [];
  return (Array.isArray(list) ? list : []).find((i) => i.product_variant_id === variantId);
}

(async () => {
  const tag = crypto.randomBytes(4).toString("hex");
  const reg = await call(A, "POST", "/api/v1/auth/register", {
    body: { email: `soak.${tag}@example.test`, password: crypto.randomBytes(18).toString("base64url"), name: "Soak Test", workspaceName: `Soak ${tag}` },
  });
  const cookie = reg.cookies.find((c) => c.startsWith("commerceos_session="))?.split(";")[0];
  if (reg.status !== 201 || !cookie) throw new Error(`register failed: HTTP ${reg.status}`);
  const prod = await call(A, "POST", "/api/v1/products", { cookie, body: { name: "Soak Kurta", sku: `SOAK-${tag}`, base_price: 1000, initial_stock: 0 } });
  if (prod.status !== 201) throw new Error(`product failed: HTTP ${prod.status}`);
  const created = prod.json?.data?.product;
  const products = await call(A, "GET", "/api/v1/products?limit=100", { cookie });
  const variant =
    created?.variants?.[0] ??
    (products.json?.data || []).filter((p) => p.id === created?.id).flatMap((p) => p.variants || [])[0];
  if (!variant?.id) throw new Error("the new product has no variant");
  const start = await inventoryOf(A, cookie, variant.id);
  if (!start) throw new Error("no stock row for the product");
  out(`workspace ready (tenant ${reg.json?.data?.tenant?.id}); ${workers} workers for ${minutes} min on 2 servers`);
  for (let i = 0; i < 30 && !(await inventoryOf(B, cookie, variant.id)); i++) await sleep(1000); // B has synced

  const deadline = Date.now() + minutes * 60_000;
  const servers = [A, B];
  let turn = 0;
  const worker = async (w) => {
    while (Date.now() < deadline) {
      const base = servers[turn++ % 2];
      const pick = chance();
      try {
        if (pick < 0.55) {
          const r = await withRetry(() =>
            call(base, "POST", "/api/v1/inventory/adjust", {
              cookie,
              body: { warehouse_id: start.warehouse_id, product_variant_id: variant.id, quantity_delta: 1, type: "PURCHASE", reason: `soak w${w}` },
            })
          );
          if (r.status === 200) stats.adjust_ok++;
          else if (r.status !== 409) bump(`adjust_${r.status}`);
        } else if (pick < 0.75) {
          const r = await withRetry(() =>
            call(base, "POST", "/api/v1/orders", {
              cookie,
              body: {
                customer: { first_name: `Soak${w}`, phone: `0171${String(crypto.randomInt(0, 10_000_000)).padStart(7, "0")}` },
                delivery_address: { district: "Dhaka", address_line_1: "House 1" },
                items: [{ variant_id: variant.id, quantity: 1 }],
                payment_method: "COD",
              },
            })
          );
          if (r.status === 201) stats.order_ok++;
          else if (r.status !== 409 && r.status !== 400) bump(`order_${r.status}`); // 400: no stock available yet
        } else {
          const r = await call(base, "GET", pick < 0.9 ? "/api/v1/orders?limit=20" : "/api/v1/inventory", { cookie });
          if (r.status === 200) stats.read_ok++;
          else bump(`read_${r.status}`);
        }
      } catch (err) {
        bump(`network_${err.code || err.name}`);
      }
    }
  };
  const ticker = setInterval(() => out(`  ${new Date().toISOString()} adjust=${stats.adjust_ok} orders=${stats.order_ok} reads=${stats.read_ok} 409=${stats.conflict_409} busy=${stats.busy_503} errors=${JSON.stringify(stats.errors)}`), 60_000);
  await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
  clearInterval(ticker);
  const ended = Date.now();

  // Each server must converge on the acknowledged totals within the staleness limit (it may be behind at first)
  const checks = [];
  for (const [name, base] of [["A", A], ["B", B]]) {
    let snapshot;
    do {
      const inv = await inventoryOf(base, cookie, variant.id);
      const orders = await call(base, "GET", "/api/v1/orders?limit=1", { cookie });
      snapshot = {
        onHand: inv ? inv.quantity_on_hand - start.quantity_on_hand : null,
        reserved: inv ? inv.quantity_reserved - start.quantity_reserved : null,
        listed: typeof orders.json?.meta?.total === "number" ? orders.json.meta.total : null,
      };
      if (snapshot.onHand === stats.adjust_ok && snapshot.reserved === stats.order_ok && snapshot.listed === stats.order_ok) break;
      await sleep(1000);
    } while (Date.now() - ended < convergeMs);
    out(`  ${name} checked ${Math.round((Date.now() - ended) / 100) / 10} s after the load ended`);
    checks.push([`${name}: stock on hand = acknowledged increments (${stats.adjust_ok})`, snapshot.onHand === stats.adjust_ok, snapshot.onHand]);
    checks.push([`${name}: reserved stock = acknowledged orders (${stats.order_ok})`, snapshot.reserved === stats.order_ok, snapshot.reserved]);
    checks.push([`${name}: orders listed = acknowledged orders (${stats.order_ok})`, snapshot.listed === stats.order_ok, snapshot.listed ?? "?"]);
    // Nothing more than acknowledged either: an unacknowledged write (a request that got an error) must not appear
  }
  checks.push(["no requests failed with 5xx", !Object.keys(stats.errors).some((k) => /_5\d\d$/.test(k)), JSON.stringify(stats.errors)]);
  out("");
  for (const [name, ok, actual] of checks) out(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${actual}`);
  out(`  totals: ${JSON.stringify(stats)}`);
  const pass = checks.every(([, ok]) => ok);
  out(pass ? "SOAK PASS" : "SOAK FAIL");
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  process.stderr.write(`Soak test crashed: ${err.message}\n`);
  process.exit(1);
});
