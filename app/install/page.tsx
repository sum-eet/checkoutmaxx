"use client";

import { useEffect } from "react";

export default function InstallPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get("shop");
    if (shop) {
      window.location.href = `/api/auth?shop=${shop}`;
    }
  }, []);

  return null;
}
