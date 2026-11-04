import Link from "next/link";
import LogoutButton from "./LogoutButton";
import type { PublicUser } from "@/lib/auth";

export default function SiteHeader({ user }: { user: PublicUser | null }) {
  return (
    <header className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-10">
      <Link href="/" className="inline-flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.18em] text-lime">
        <span className="h-2 w-2 rounded-full bg-lime" /> LeadHunter
      </Link>
      <nav className="flex items-center gap-2 text-sm">
        {user ? (
          <>
            <span className="hidden text-zinc-500 sm:inline">{user.email}</span>
            <Link href="/dashboard" className="rounded-lg border border-ink-line px-3 py-1.5 text-zinc-200 transition hover:border-lime/50 hover:text-lime">
              Painel
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login" className="rounded-lg px-3 py-1.5 text-zinc-300 transition hover:text-white">
              Entrar
            </Link>
            <Link href="/register" className="rounded-lg bg-lime px-3 py-1.5 font-semibold text-ink transition hover:bg-[#c2f25c]">
              Criar conta
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
