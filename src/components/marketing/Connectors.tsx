"use client";

import { useState } from "react";
import { CONNECTOR_ROWS, STATUS_LABEL } from "./content";
import { c } from "./classes";

const ROW_OFFSET = ["row-a", "row-b", "row-c"] as const;

/** The connector tiles. The switches are a demo: they show how connecting feels, they do not connect anything. */
export function Connectors() {
  const [on, setOn] = useState<Record<string, boolean>>({ cod: true, ai: true });

  return (
    <section id="connectors" className={c("sec")}>
      <div className={c("wrap")}>
        <div className={c("conn-grid")}>
          <div>
            <span className={c("eyebrow")}><i />Connectors</span>
            <h2 className={c("h2")}>Plugs into the tools <span className={c("hl")}>you already use.</span></h2>
            <p className={c("lede")}>
              Cash on delivery and your own AI model work today. Telegram, bKash and SSLCommerz are being proven; Meta channels and couriers
              come next. Every webhook is signed and checked before it touches an order.
            </p>
            <div className={c("clist")}>
              <div><h4>Channels</h4><p>Telegram in beta. Facebook, Instagram and WhatsApp planned</p></div>
              <div><h4>Payments</h4><p>Cash on delivery today. bKash and SSLCommerz being proven</p></div>
              <div><h4>Couriers</h4><p>Manual shipments today. Steadfast booking planned</p></div>
              <div><h4>AI models</h4><p>Any OpenAI-compatible provider, your own keys</p></div>
            </div>
          </div>

          <div className={c("conn-card")}>
            <div className={c("conn-head")}>
              <h3>Connectors we provide</h3>
              <span className={c("muted small")}>Tap a tile to switch it on · Planned ones are on the roadmap</span>
            </div>
            <div className={c("conn-rows")}>
              {CONNECTOR_ROWS.map((row, r) => (
                <div key={r} className={c(`crow ${ROW_OFFSET[r]}`)}>
                  {row.map((cn) => {
                    const active = !!on[cn.id];
                    return (
                      <button
                        key={cn.id}
                        type="button"
                        className={c(active ? "ctile on" : "ctile")}
                        aria-pressed={active}
                        onClick={() => setOn((prev) => ({ ...prev, [cn.id]: !prev[cn.id] }))}
                      >
                        {cn.icon ? (
                          <img className={c("cicon")} src={cn.icon} alt="" width={28} height={28} />
                        ) : (
                          <span className={c("cmono")}>{cn.mark}</span>
                        )}
                        <span className={c("cname")}>{cn.name}</span>
                        <span className={c("cmeta")}>{cn.kind} · {STATUS_LABEL[cn.status]}</span>
                        <span className={c("tgl")} aria-hidden="true"><i /></span>
                      </button>
                    );
                  })}
                  <span className={c("cblank")} aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
