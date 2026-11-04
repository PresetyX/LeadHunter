"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Lock, Mail, TriangleAlert, User } from "lucide-react";

export default function AuthForm({ mode, next }: { mode: "login" | "register"; next?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { name, email, password } : { email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Algo deu errado.");
      // só redireciona para caminhos internos
      const dest = next && /^\/[a-zA-Z0-9/_-]*$/.test(next) && !next.startsWith("//") ? next : "/dashboard";
      window.location.href = dest;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  const input =
    "h-11 w-full rounded-xl border border-ink-line bg-ink-soft pl-9 pr-3 text-[15px] text-white outline-none transition placeholder:text-zinc-600 focus:border-lime/60 focus:ring-2 focus:ring-lime/20";

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-ink-line bg-ink/80 p-6 shadow-2xl shadow-black/30 sm:p-8">
      <h1 className="text-2xl font-semibold text-white">{isRegister ? "Criar sua conta" : "Entrar"}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {isRegister ? "Depois do cadastro você libera o acesso vitalício por R$ 30." : "Acesse seu painel de leads."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        {isRegister && (
          <label className="relative block">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input className={input} placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} />
          </label>
        )}
        <label className="relative block">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input className={input} type="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="relative block">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className={input}
            type="password"
            placeholder={isRegister ? "Senha (mín. 8 caracteres)" : "Senha"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            minLength={isRegister ? 8 : 1}
          />
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime font-semibold text-ink transition hover:bg-[#c2f25c] disabled:opacity-60"
        >
          {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {isRegister ? "Criar conta" : "Entrar"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-zinc-500">
        {isRegister ? (
          <>
            Já tem conta?{" "}
            <Link href="/login" className="text-lime hover:underline">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Ainda não tem conta?{" "}
            <Link href="/register" className="text-lime hover:underline">
              Criar conta
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
