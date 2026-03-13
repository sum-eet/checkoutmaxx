import { supabase } from "./supabase";

export type DateRange = { start: Date; end: Date };

export type FunnelStep = {
  step: string;
  label: string;
  sessions: number;
  pct: number;
  dropPct: number;
};

export type KpiMetrics = {
  checkoutsStarted: number;
  completedOrders: number;
  cvr: number;
  cvrDelta: number | null;
  baselineCvr: number | null;
};

export type LiveEvent = {
  id: string;
  eventType: string;
  sessionId: string;
  deviceType: string | null;
  country: string | null;
  discountCode: string | null;
  totalPrice: number | null;
  currency: string | null;
  errorMessage: string | null;
  occurredAt: Date;
};

export type TopError = {
  type: string;
  label: string;
  count: number;
};

export type DroppedProduct = {
  title: string;
  count: number;
  pctOfDrops: number;
};

export type StatusBannerState = "healthy" | "critical" | "learning" | "no_data";

export type StatusResult = {
  state: StatusBannerState;
  activeAlert?: { title: string; id: string };
};

const FUNNEL_STEPS = [
  { step: "checkout_started", label: "Checkout Started" },
  { step: "checkout_contact_info_submitted", label: "Contact Info" },
  { step: "checkout_address_info_submitted", label: "Address" },
  { step: "checkout_shipping_info_submitted", label: "Shipping" },
  { step: "payment_info_submitted", label: "Payment" },
  { step: "checkout_completed", label: "Completed" },
];

export async function getShopByDomain(shopDomain: string) {
  const { data } = await supabase
    .from("Shop")
    .select("*")
    .eq("shopDomain", shopDomain)
    .single();
  return data;
}

export async function getKpiMetrics(shopId: string, range: DateRange): Promise<KpiMetrics> {
  const [startedRes, completedRes, baselineRes] = await Promise.all([
    supabase.from("CheckoutEvent")
      .select("sessionId")
      .eq("shopId", shopId)
      .eq("eventType", "checkout_started")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
    supabase.from("CheckoutEvent")
      .select("sessionId")
      .eq("shopId", shopId)
      .eq("eventType", "checkout_completed")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
    supabase.from("Baseline")
      .select("value")
      .eq("shopId", shopId)
      .eq("metricName", "checkout_cvr")
      .order("computedAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const started = startedRes.data ?? [];
  const completed = completedRes.data ?? [];

  const startedSet = new Set(started.map((r: any) => r.sessionId));
  const completedSet = new Set(completed.map((r: any) => r.sessionId));
  completed.forEach((r: any) => startedSet.add(r.sessionId));

  const checkoutsStarted = startedSet.size;
  const completedOrders = completedSet.size;
  const cvr = checkoutsStarted > 0 ? completedOrders / checkoutsStarted : 0;
  const baselineCvr = baselineRes.data?.value ?? null;
  const cvrDelta = baselineCvr !== null ? cvr - baselineCvr : null;

  return { checkoutsStarted, completedOrders, cvr, cvrDelta, baselineCvr };
}

export async function getFunnelMetrics(
  shopId: string,
  range: DateRange,
  device?: string,
  country?: string
): Promise<FunnelStep[]> {
  const query = (eventType: string) => {
    let q = supabase.from("CheckoutEvent")
      .select("sessionId")
      .eq("shopId", shopId)
      .eq("eventType", eventType)
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString());
    if (device) q = q.eq("deviceType", device);
    if (country) q = q.eq("country", country);
    return q;
  };

  const results = await Promise.all(FUNNEL_STEPS.map((s) => query(s.step)));

  const startedRows = results[0].data ?? [];
  const completedRows = results[results.length - 1].data ?? [];

  const startedSet = new Set(startedRows.map((r: any) => r.sessionId));
  completedRows.forEach((r: any) => startedSet.add(r.sessionId));
  const unionTotal = startedSet.size;

  const counts = results.map((r) => new Set((r.data ?? []).map((x: any) => x.sessionId)).size);
  counts[0] = unionTotal;
  counts[counts.length - 1] = completedRows.length;

  const baseline = counts[0] || 1;
  const capped = counts.map((c) => Math.min(c, baseline));

  return FUNNEL_STEPS.map((s, i) => ({
    step: s.step,
    label: s.label,
    sessions: capped[i],
    pct: Math.round((capped[i] / baseline) * 100),
    dropPct: i > 0 ? Math.round(((capped[i - 1] - capped[i]) / baseline) * 100) : 0,
  }));
}

export async function getLiveEventFeed(shopId: string, limit = 50): Promise<LiveEvent[]> {
  const { data } = await supabase.from("CheckoutEvent")
    .select("id, eventType, sessionId, deviceType, country, discountCode, totalPrice, currency, errorMessage, occurredAt")
    .eq("shopId", shopId)
    .order("occurredAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r: any) => ({ ...r, occurredAt: new Date(r.occurredAt) }));
}

export async function getTopErrors(shopId: string, range: DateRange): Promise<TopError[]> {
  const [discountRes, extensionRes, paymentRes, completedRes] = await Promise.all([
    supabase.from("CheckoutEvent")
      .select("*", { count: "exact", head: true })
      .eq("shopId", shopId)
      .eq("eventType", "alert_displayed")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
    supabase.from("CheckoutEvent")
      .select("*", { count: "exact", head: true })
      .eq("shopId", shopId)
      .eq("eventType", "ui_extension_errored")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
    supabase.from("CheckoutEvent")
      .select("sessionId")
      .eq("shopId", shopId)
      .eq("eventType", "payment_info_submitted")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
    supabase.from("CheckoutEvent")
      .select("sessionId")
      .eq("shopId", shopId)
      .eq("eventType", "checkout_completed")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
  ]);

  const discountErrors = discountRes.count ?? 0;
  const extensionErrors = extensionRes.count ?? 0;
  const paymentSessions = new Set((paymentRes.data ?? []).map((r: any) => r.sessionId));
  const completedSessions = new Set((completedRes.data ?? []).map((r: any) => r.sessionId));
  const paymentDropoffs = Array.from(paymentSessions).filter((id) => !completedSessions.has(id)).length;

  return [
    { type: "discount_error", label: "Discount code error", count: discountErrors },
    { type: "payment_dropoff", label: "Payment drop-off", count: paymentDropoffs },
    { type: "extension_error", label: "Extension error", count: extensionErrors },
  ].filter((e) => e.count > 0);
}

export async function getDroppedProducts(shopId: string, range: DateRange): Promise<DroppedProduct[]> {
  const [startedRes, completedRes] = await Promise.all([
    supabase.from("CheckoutEvent")
      .select("sessionId, rawPayload")
      .eq("shopId", shopId)
      .eq("eventType", "checkout_started")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
    supabase.from("CheckoutEvent")
      .select("sessionId")
      .eq("shopId", shopId)
      .eq("eventType", "checkout_completed")
      .gte("occurredAt", range.start.toISOString())
      .lte("occurredAt", range.end.toISOString()),
  ]);

  const completedSet = new Set((completedRes.data ?? []).map((r: any) => r.sessionId));
  const seenSessions = new Set<string>();
  const dropped = (startedRes.data ?? []).filter((r: any) => {
    if (completedSet.has(r.sessionId) || seenSessions.has(r.sessionId)) return false;
    seenSessions.add(r.sessionId);
    return true;
  });

  const productMap = new Map<string, number>();
  for (const event of dropped) {
    const payload = event.rawPayload as Record<string, unknown>;
    const lineItems: unknown[] =
      (payload?.checkout as Record<string, unknown>)?.lineItems as unknown[] ?? [];
    for (const item of lineItems) {
      const i = item as Record<string, unknown>;
      const productTitle = (i?.title as string) || "Unknown Product";
      const variant = i?.variant as Record<string, unknown> | undefined;
      const variantTitle = variant?.title as string | undefined;
      const key =
        variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} (${variantTitle})`
          : productTitle;
      productMap.set(key, (productMap.get(key) || 0) + 1);
    }
  }

  const total = Array.from(productMap.values()).reduce((a, b) => a + b, 0) || 1;
  return Array.from(productMap.entries())
    .map(([title, count]) => ({ title, count, pctOfDrops: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function getStatusBannerState(shopId: string): Promise<StatusResult> {
  const { data: shop } = await supabase.from("Shop").select("installedAt").eq("id", shopId).single();
  if (!shop) return { state: "no_data" };

  const hoursSinceInstall = (Date.now() - new Date(shop.installedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceInstall < 48) return { state: "learning" };

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase.from("CheckoutEvent")
    .select("*", { count: "exact", head: true })
    .eq("shopId", shopId)
    .gte("occurredAt", thirtyMinAgo);
  if (!recentCount || recentCount === 0) return { state: "no_data" };

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: activeAlert } = await supabase.from("AlertLog")
    .select("id, title")
    .eq("shopId", shopId)
    .is("resolvedAt", null)
    .gte("firedAt", twoHoursAgo)
    .order("firedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeAlert) return { state: "critical", activeAlert };

  return { state: "healthy" };
}

export type FailedDiscount = {
  code: string;
  count: number;
  lastSeen: Date;
  errorMessage: string | null;
};

export async function getFailedDiscounts(shopId: string, range: DateRange): Promise<FailedDiscount[]> {
  const { data: events } = await supabase.from("CheckoutEvent")
    .select("discountCode, errorMessage, occurredAt, rawPayload")
    .eq("shopId", shopId)
    .eq("eventType", "alert_displayed")
    .gte("occurredAt", range.start.toISOString())
    .lte("occurredAt", range.end.toISOString())
    .order("occurredAt", { ascending: false });

  const map = new Map<string, { count: number; lastSeen: Date; errorMessage: string | null }>();
  for (const e of (events ?? [])) {
    const payload = e.rawPayload as Record<string, unknown>;
    const alert = payload?.alert as Record<string, unknown> | undefined;
    const code =
      e.discountCode ||
      (alert?.target === "cart.discountCode" && alert?.value ? String(alert.value) : null);
    if (!code) continue;

    const occurredAt = new Date(e.occurredAt);
    const existing = map.get(code);
    if (existing) {
      existing.count++;
      if (occurredAt > existing.lastSeen) existing.lastSeen = occurredAt;
    } else {
      map.set(code, { count: 1, lastSeen: occurredAt, errorMessage: e.errorMessage });
    }
  }

  return Array.from(map.entries())
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);
}

export async function getDistinctCountries(shopId: string, range: DateRange): Promise<string[]> {
  const { data } = await supabase.from("CheckoutEvent")
    .select("country")
    .eq("shopId", shopId)
    .not("country", "is", null)
    .gte("occurredAt", range.start.toISOString())
    .lte("occurredAt", range.end.toISOString());
  const unique = Array.from(new Set((data ?? []).map((r: any) => r.country).filter(Boolean))).slice(0, 20);
  return unique as string[];
}
