"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    router.replace(`/dashboard/converted?${params.toString()}`);
  }, [router]);
  return null;
}
