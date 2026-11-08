"use client";

import { CalendarClock, Gauge, PackagePlus, Search, TriangleAlert } from "lucide-react";
import { CREDIT_PACK, MONTHLY_BY_ID, brl } from "@/lib/plan";
import type { Usage } from "@/lib/quota";
import { CheckoutError, MonthlyPlans, useCheckout } from "./Pricing";

function planLabel(u: Usage): string {
  if (u.mode === "monthly" && u.plan && u.plan !== "lifetime") return `Plano ${MONTHLY_BY_ID[u.plan].name}`;
  if (u.mode === "lifetime") return u.hasLifetime ? "Vitalício de lançamento" : "Pacote de leads";
  return "Sem plano";
}

/** Medidor de uso (leads e buscas do dia). */
export function UsageMeter({ usage }: { usage: Usage }) {
  const pct = usage.unlimited ? 0 : usage.leadsLimit ? Math.min(100, (usage.leadsUsed / usage.leadsLimit) * 100) : 100;
  const low = !usage.unlimited && usage.leadsRemaining <= Math.max(50, usage.leadsLimit * 0.1);
  return (
    <div className="mb-4 grid gap-3 rounded-2xl border border-ink-line bg-ink/60 p-4 text-sm sm:grid-cols-[1.4fr_1fr_1fr]">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-zinc-300">
            <Gauge className="h-4 w-4 text-lime" /> {planLabel(usage)}
          </span>
          <span className={`font-mono text-xs tabular-nums ${low ? "text-amber-300" : "text-zinc-400"}`}>
            {usage.unlimited
              ? `${usage.leadsUsed.toLocaleString("pt-BR")} leads este mês`
              : `${usage.leadsRemaining.toLocaleString("pt-BR")} leads restantes`}
          </span>
        </div>
        {!usage.unlimited && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-line">
            <div className={`h-full rounded-full ${low ? "bg-amber-400" : "bg-lime"}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="inline-flex items-center gap-1.5 text-zinc-400">
        <Search className="h-4 w-4 text-lime" /> Buscas hoje:{" "}
        <span className="font-mono tabular-nums text-zinc-200">
          {usage.searchesToday}/{usage.searchesLimit}
        </span>
      </div>
      <div className="inline-flex items-center gap-1.5 text-zinc-400">
        <CalendarClock className="h-4 w-4 text-lime" />
        {usage.planUntil ? (
          <>Válido até {new Date(usage.planUntil).toLocaleDateString("pt-BR")}</>
        ) : usage.mode === "lifetime" ? (
          <>Sem mensalidade</>
        ) : (
          <>—</>
        )}
      </div>
    </div>
  );
}

/** Aparece quando o limite acaba: pacote de créditos (R$15 por +1.000) ou migração para um plano mensal. */
export function UpgradePanel({ usage, reason }: { usage: Usage; reason: "QUOTA_EXCEEDED" | "DAILY_LIMIT" | "NO_PLAN" }) {
  const checkout = useCheckout();
  return (
    <section className="mb-6 rounded-2xl border border-amber-400/40 bg-amber-400/[0.04] p-5 sm:p-6">
      <div className="flex items-start gap-2 text-amber-200">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h2 className="font-semibold text-white">
            {reason === "DAILY_LIMIT" ? "Limite de buscas de hoje atingido" : "Você usou todos os leads do seu plano"}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {reason === "DAILY_LIMIT"
              ? "O contador zera à meia-noite (horário de Brasília). Para buscar mais por dia, mude para um plano mensal."
              : "Continue prospectando agora: adicione um pacote de leads ou mude para um plano mensal."}
          </p>
        </div>
      </div>

      {reason !== "DAILY_LIMIT" && (usage.hasLifetime || usage.mode !== "none") && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-lime/40 bg-ink/70 p-4">
          <div>
            <div className="inline-flex items-center gap-1.5 font-medium text-white">
              <PackagePlus className="h-4 w-4 text-lime" /> Pacote de Créditos Extra ({brl(CREDIT_PACK.priceBRL)} por +{CREDIT_PACK.leads.toLocaleString("pt-BR")} leads)
            </div>
            <p className="text-sm text-zinc-400">Pagamento único, não expira — soma ao seu saldo de leads.</p>
          </div>
          <button
            onClick={() => checkout.buy("credits_1000")}
            disabled={!!checkout.busy}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-lime px-5 font-semibold text-ink transition hover:bg-[#c2f25c] disabled:opacity-60"
          >
            Comprar +{CREDIT_PACK.leads.toLocaleString("pt-BR")} leads por {brl(CREDIT_PACK.priceBRL)}
          </button>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">ou migre para um plano mensal</div>
        <MonthlyPlans loggedIn checkout={checkout} compact />
      </div>
      <CheckoutError message={checkout.error} />
    </section>
  );
}
