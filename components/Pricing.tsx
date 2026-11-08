"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, CreditCard, Flame, LoaderCircle, QrCode, ShieldCheck, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { CREDIT_PACK, LAUNCH_SLOTS, LIFETIME, MONTHLY_PLANS, brl, type ProductId } from "@/lib/plan";
import type { PricingMode } from "@/lib/pricing";

const MP_URL = /^https:\/\/(www\.)?mercadopago\.com(\.br)?\//;

/** Cria o checkout no servidor (que decide preço e elegibilidade) e redireciona ao Mercado Pago. */
export function useCheckout() {
  const [busy, setBusy] = useState<ProductId | null>(null);
  const [error, setError] = useState("");
  async function buy(product: ProductId) {
    setBusy(product);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = "/login?next=/dashboard";
        return;
      }
      if (!res.ok) throw new Error(json.error || "Não foi possível iniciar o pagamento.");
      const url = String(json.url || "");
      if (!MP_URL.test(url)) throw new Error("Endereço de pagamento inválido.");
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  return { busy, error, buy };
}

function Cta({
  product,
  label,
  loggedIn,
  checkout,
  primary = true,
}: {
  product: ProductId;
  label: string;
  loggedIn: boolean;
  checkout: ReturnType<typeof useCheckout>;
  primary?: boolean;
}) {
  const cls = primary
    ? "bg-lime text-ink hover:bg-[#c2f25c]"
    : "border border-lime/40 text-lime hover:border-lime hover:bg-lime/10";
  const base = `mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold transition disabled:opacity-60 ${cls}`;
  if (!loggedIn) {
    return (
      <Link href="/register" className={base}>
        {label}
      </Link>
    );
  }
  return (
    <button onClick={() => checkout.buy(product)} disabled={!!checkout.busy} className={base}>
      {checkout.busy === product ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
      {label}
    </button>
  );
}

function PayMethods() {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-zinc-500">
      <span className="inline-flex items-center gap-1">
        <QrCode className="h-3.5 w-3.5" /> Pix
      </span>
      <span className="inline-flex items-center gap-1">
        <CreditCard className="h-3.5 w-3.5" /> Cartão
      </span>
      <span>Pagamento processado pelo Mercado Pago</span>
    </div>
  );
}

export function LaunchCard({ slotsLeft, loggedIn, checkout }: { slotsLeft: number; loggedIn: boolean; checkout: ReturnType<typeof useCheckout> }) {
  const taken = LAUNCH_SLOTS - slotsLeft;
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-lime/40 bg-ink/80 p-6 shadow-2xl shadow-lime/5 sm:p-8">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-3 py-1 text-xs font-medium text-lime">
        <Flame className="h-3.5 w-3.5" /> Oferta de Lançamento: {slotsLeft}/{LAUNCH_SLOTS} vagas restantes ({brl(LIFETIME.priceBRL)} vitalício)
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-line" aria-hidden>
        <div className="h-full rounded-full bg-lime" style={{ width: `${(taken / LAUNCH_SLOTS) * 100}%` }} />
      </div>
      <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-lime">Plano de lançamento · vitalício</div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-5xl font-semibold tracking-tight text-white">{brl(LIFETIME.priceBRL)}</span>
        <span className="mb-1.5 text-sm text-zinc-500">pago uma vez</span>
      </div>
      <ul className="mt-6 space-y-2.5 text-sm text-zinc-300">
        {[
          `Até ${LIFETIME.leadsIncluded.toLocaleString("pt-BR")} leads inclusos`,
          `Até ${LIFETIME.dailySearches} buscas por dia`,
          "Enriquecimento com e-mail, WhatsApp e redes sociais",
          "Exportação CSV (Excel) e XLSX",
          `Precisa de mais? Pacotes de +${CREDIT_PACK.leads.toLocaleString("pt-BR")} leads por ${brl(CREDIT_PACK.priceBRL)}`,
        ].map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime" /> {f}
          </li>
        ))}
      </ul>
      <Cta product="lifetime" label={loggedIn ? `Garantir minha vaga por ${brl(LIFETIME.priceBRL)}` : "Criar conta e garantir a vaga"} loggedIn={loggedIn} checkout={checkout} />
      <PayMethods />
    </div>
  );
}

export function MonthlyPlans({ loggedIn, checkout, compact = false }: { loggedIn: boolean; checkout: ReturnType<typeof useCheckout>; compact?: boolean }) {
  return (
    <div>
      <div className={`grid gap-4 ${compact ? "lg:grid-cols-3" : "md:grid-cols-3"}`}>
        {MONTHLY_PLANS.map((p) => (
          <div
            key={p.id}
            className={`relative flex flex-col rounded-2xl border bg-ink/80 p-6 ${
              p.highlight ? "border-lime shadow-2xl shadow-lime/10 md:-translate-y-2" : "border-ink-line"
            }`}
          >
            {p.highlight && (
              <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-lime px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink">
                <Sparkles className="h-3 w-3" /> Mais popular
              </span>
            )}
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-lime">{p.name}</div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-4xl font-semibold tracking-tight text-white">{brl(p.priceBRL)}</span>
              <span className="mb-1 text-sm text-zinc-500">/mês</span>
            </div>
            <ul className="mt-5 flex-1 space-y-2.5 text-sm text-zinc-300">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime" /> {f}
                </li>
              ))}
            </ul>
            <Cta product={p.id} label={`Assinar ${p.name}`} loggedIn={loggedIn} checkout={checkout} primary={!!p.highlight} />
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-zinc-500">
        Cada pagamento libera 30 dias (Pix ou cartão) — renove quando quiser, sem fidelidade. *Business: uso justo de até{" "}
        {MONTHLY_PLANS[2].fairUseLeadsPerMonth.toLocaleString("pt-BR")} leads/mês para proteger a API.
      </p>
    </div>
  );
}

export function CheckoutError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="mx-auto mt-4 flex max-w-lg items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {message}
    </div>
  );
}

/**
 * Seção de preços. O modo (lançamento x mensal) vem do servidor, calculado pela contagem de
 * vendas. O dev-toggle só troca a PRÉ-VISUALIZAÇÃO: o checkout continua validado no servidor.
 */
export default function Pricing({
  mode,
  slotsLeft,
  devToggle,
  loggedIn,
}: {
  mode: PricingMode;
  slotsLeft: number;
  devToggle: boolean;
  loggedIn: boolean;
}) {
  const [preview, setPreview] = useState<PricingMode>(mode);
  const checkout = useCheckout();
  const shown = devToggle ? preview : mode;

  return (
    <div>
      {devToggle && (
        <div data-testid="dev-toggle" className="mx-auto mb-6 flex w-fit items-center gap-1 rounded-full border border-dashed border-amber-400/50 bg-amber-400/5 p-1 text-xs">
          <span className="inline-flex items-center gap-1 px-2 text-amber-300">
            <Wrench className="h-3.5 w-3.5" /> dev-toggle
          </span>
          {(["launch", "monthly"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPreview(m)}
              className={`rounded-full px-3 py-1 transition ${preview === m ? "bg-amber-300 text-ink" : "text-zinc-400 hover:text-white"}`}
            >
              {m === "launch" ? `Lançamento ${brl(LIFETIME.priceBRL)}` : "3 planos mensais"}
            </button>
          ))}
          <span className="px-2 text-zinc-500">real: {mode === "launch" ? `lançamento (${slotsLeft} vagas)` : "mensal"}</span>
        </div>
      )}
      {shown === "launch" ? (
        <LaunchCard slotsLeft={slotsLeft} loggedIn={loggedIn} checkout={checkout} />
      ) : (
        <MonthlyPlans loggedIn={loggedIn} checkout={checkout} />
      )}
      <CheckoutError message={checkout.error} />
    </div>
  );
}
