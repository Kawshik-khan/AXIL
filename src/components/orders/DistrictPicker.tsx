"use client";

import React, { useEffect, useState } from "react";
import { BD_64_DISTRICTS, BD_DIVISIONS, findDistrict } from "@/lib/bd-geography";

export interface DeliveryFees {
  inside_dhaka_bdt: number;
  outside_dhaka_bdt: number;
}

/**
 * The workspace's delivery fees from its settings (`GET /tenants/current`). null until loaded or when they can't be
 * read; callers show "—" rather than a guessed fee (the order forms used to print literal fees).
 */
export function useDeliveryFees(): DeliveryFees | null {
  const [fees, setFees] = useState<DeliveryFees | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/tenants/current")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const f = json?.data?.delivery_fees;
        if (!cancelled && f && typeof f.inside_dhaka_bdt === "number" && typeof f.outside_dhaka_bdt === "number") setFees(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return fees;
}

interface Props {
  district: string;
  onChange: (district: string) => void;
  fees: DeliveryFees | null;
  selectStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
}

/**
 * Pick one of the 64 districts; the delivery zone (and its fee) follows from it (FX-36 M5).
 */
export function DistrictPicker({ district, onChange, fees, selectStyle, labelStyle }: Props) {
  const spec = findDistrict(district);
  const fee = spec && fees ? (spec.zone === "INSIDE_DHAKA" ? fees.inside_dhaka_bdt : fees.outside_dhaka_bdt) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={labelStyle}>District *</label>
      <select value={spec?.district ?? ""} onChange={(e) => onChange(e.target.value)} required style={selectStyle}>
        <option value="">Choose a district</option>
        {BD_DIVISIONS.map((division) => (
          <optgroup key={division} label={`${division} Division`}>
            {BD_64_DISTRICTS.filter((x) => x.division === division).map((x) => (
              <option key={x.district} value={x.district}>
                {x.district}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
        {spec
          ? `${spec.zone === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"} · delivery charge ${fee !== null ? `৳${fee}` : "—"}`
          : "The delivery zone and charge follow from the district."}
      </span>
    </div>
  );
}
