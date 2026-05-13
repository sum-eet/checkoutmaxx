import {
  reactExtension,
  useApplyDiscountCodeChange,
  useShop,
  useInstructions,
  Banner,
  Button,
  BlockStack,
  Text,
} from "@shopify/ui-extensions-react/checkout";
import { useState, useEffect, useRef } from "react";

const API_BASE = "https://couponmaxx.vercel.app";

export default reactExtension(
  "purchase.checkout.reductions.render-after",
  () => <CheckoutRecovery />
);

function getOrCreateSessionId(): string {
  try {
    let sid = sessionStorage.getItem("_cmx_recovery_sid");
    if (!sid) {
      sid = "cs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem("_cmx_recovery_sid", sid);
    }
    return sid;
  } catch {
    // sessionStorage unavailable in some checkout contexts
    return "cs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  }
}

function CheckoutRecovery() {
  const { myshopifyDomain } = useShop();
  const instructions = useInstructions();
  const applyDiscount = useApplyDiscountCodeChange();

  const [state, setState] = useState<"loading" | "none" | "issued">("loading");
  const [issue, setIssue] = useState<{ code: string; expiresAt: string } | null>(null);
  const sessionIdRef = useRef<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    sessionIdRef.current = getOrCreateSessionId();
    console.log("[CMX Recovery Extension] mount shop=%s sid=%s", myshopifyDomain, sessionIdRef.current);
    fetchIssue();
    return () => { mountedRef.current = false; };
  }, []);

  async function fetchIssue() {
    try {
      const res = await fetch(`${API_BASE}/api/checkoutlens/recovery/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopDomain: myshopifyDomain,
          sessionId: sessionIdRef.current,
        }),
      });
      const data = await res.json();
      console.log("[CMX Recovery Extension] /check response:", data);
      if (!mountedRef.current) return;
      if (data.status === "issued" || data.status === "already_issued") {
        setIssue({ code: data.code, expiresAt: data.expiresAt });
        setState("issued");
      } else {
        setState("none");
      }
    } catch (err) {
      console.warn("[CMX Recovery Extension] /check error:", err);
      if (mountedRef.current) setState("none");
    }
  }

  async function claim() {
    if (!issue) return;
    console.log("[CMX Recovery Extension] claim code=%s", issue.code);
    try {
      await fetch(`${API_BASE}/api/checkoutlens/cx`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopDomain: myshopifyDomain,
          sessionId: sessionIdRef.current,
        }),
      });
    } catch (err) {
      console.warn("[CMX Recovery Extension] /cx error:", err);
    }
    try {
      const result = await applyDiscount({ type: "addDiscountCode", code: issue.code });
      console.log("[CMX Recovery Extension] applyDiscount result:", result);
    } catch (err) {
      console.warn("[CMX Recovery Extension] applyDiscount error:", err);
    }
    if (mountedRef.current) setState("none");
  }

  const canUpdate = instructions?.discounts?.canUpdateDiscountCodes;
  console.log("[CMX Recovery Extension] state=%s canUpdate=%s", state, canUpdate);

  if (state !== "issued" || !issue) return null;

  return (
    <Banner status="success">
      <BlockStack>
        <Text emphasis="bold">Looking for a discount?</Text>
        <Button onPress={claim}>Claim {issue.code}</Button>
      </BlockStack>
    </Banner>
  );
}
