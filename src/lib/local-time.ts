/** Time in a workspace's own timezone (default Asia/Dhaka). Used by scheduled jobs and the agent's pilot hours. */
export function localHour(tenant: { timezone?: string | null }, now: number): number {
  const fmt = (tz: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(now)));
  try {
    return fmt(tenant.timezone || "Asia/Dhaka");
  } catch {
    return fmt("Asia/Dhaka");
  }
}

/** Whether `hour` falls in [start, end) on a 24-hour clock; a window may wrap midnight (22 → 6). */
export function hourWithin(hour: number, start: number, end: number): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}
