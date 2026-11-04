"use client";

import { useEffect } from "react";

// Mantém a sessão deste dispositivo viva enquanto a aba estiver visível; se a sessão acabar, vai para o login.
export default function SessionHeartbeat() {
  useEffect(() => {
    let stopped = false;
    const ping = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const res = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
      if (!res || res.status >= 500) return;
      const json = await res.json().catch(() => ({}));
      if (!json.user) window.location.href = "/login?reason=expired";
    };
    const id = setInterval(ping, 4 * 60 * 1000);
    const onVisible = () => document.visibilityState === "visible" && ping();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
