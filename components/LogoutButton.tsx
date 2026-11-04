"use client";

import { LogOut } from "lucide-react";

export default function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-zinc-400 transition hover:text-white"
      title="Sair"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">Sair</span>
    </button>
  );
}
