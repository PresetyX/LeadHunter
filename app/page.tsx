import Link from "next/link";
import { ArrowRight, Download, FileSpreadsheet, MessageCircle, Search, Sparkles } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import Pricing from "@/components/Pricing";
import { isAdminEmail, pricingState } from "@/lib/pricing";
import { LAUNCH_SLOTS, MONTHLY_PLANS, brl } from "@/lib/plan";

export const dynamic = "force-dynamic";

const SAMPLE = [
  ["Clínica Bella Pele", "Estética / Beleza", "5519998765432", "contato@bellapele.com.br"],
  ["Imobiliária Centro Sul", "Imobiliária", "5519991234567", "vendas@centrosul.com.br"],
  ["Odonto Prime", "Dentista", "551938751234", "atendimento@odontoprime.com"],
];

export default async function Home() {
  const [user, pricing] = await Promise.all([
    getCurrentUser().catch(() => null),
    pricingState().catch(() => ({ mode: "monthly" as const, sales: LAUNCH_SLOTS, slotsLeft: 0, devToggle: false })),
  ]);
  const cta = user ? "/dashboard" : "/register";
  const priceLine =
    pricing.mode === "launch"
      ? `Lançamento: R$ 30 vitalício · ${pricing.slotsLeft}/${LAUNCH_SLOTS} vagas · Pix ou cartão`
      : `Planos a partir de ${brl(MONTHLY_PLANS[0].priceBRL)}/mês · Pix ou cartão`;

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6 lg:px-10">
        <section className="grid items-center gap-10 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Leads de empresas locais, <span className="text-lime">prontos pra prospectar.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-zinc-400 sm:text-lg">
              Digite o nicho e a cidade. O LeadHunter encontra os estabelecimentos, visita o site de cada um atrás de e-mail, WhatsApp e redes
              sociais, remove duplicatas e entrega a planilha pronta.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={cta}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-lime px-6 text-[15px] font-semibold text-ink transition hover:bg-[#c2f25c]"
              >
                {user ? "Ir para o painel" : "Criar conta"} <ArrowRight className="h-4 w-4" />
              </Link>
              <span className="text-sm text-zinc-500">{priceLine}</span>
            </div>
          </div>

          {/* prévia da planilha */}
          <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink/80 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-ink-line px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
              <span>clinicas-esteticas-indaiatuba.xlsx</span>
              <FileSpreadsheet className="h-4 w-4 text-lime" />
            </div>
            <div className="divide-y divide-ink-line/70">
              {SAMPLE.map(([n, c, p, e]) => (
                <div key={n} className="grid grid-cols-[1.3fr_1fr] gap-2 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium text-white">{n}</div>
                    <div className="text-xs text-zinc-500">{c}</div>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <div className="text-emerald-400">{p}</div>
                    <div className="truncate text-zinc-400">{e}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-ink-line px-4 py-2.5 text-center font-mono text-[11px] text-zinc-600">exemplo ilustrativo</div>
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [Search, "Busca por nicho e cidade", "Clínicas estéticas em Indaiatuba, imobiliárias em Campinas — qualquer combinação."],
            [Sparkles, "Enriquecimento automático", "E-mail, Instagram, Facebook, LinkedIn e links de WhatsApp tirados do site da empresa."],
            [MessageCircle, "WhatsApp formatado", "Telefones no padrão 55DDDNÚMERO, prontos para disparo ou link wa.me."],
            [Download, "CSV e XLSX", "CSV com UTF-8-SIG que abre certo no Excel e XLSX com filtros e links clicáveis."],
          ].map(([Icon, title, text]) => {
            const I = Icon as typeof Search;
            return (
              <div key={title as string} className="rounded-2xl border border-ink-line bg-ink/60 p-5">
                <I className="h-5 w-5 text-lime" />
                <h3 className="mt-3 font-medium text-white">{title as string}</h3>
                <p className="mt-1 text-sm text-zinc-500">{text as string}</p>
              </div>
            );
          })}
        </section>

        <section id="precos" className="mt-24">
          <div className="mb-8 text-center">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-lime">Preços</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {pricing.mode === "launch" ? "Oferta de lançamento por tempo limitado" : "Escolha o plano do seu volume"}
            </h2>
          </div>
          <div className="mx-auto max-w-5xl">
            <Pricing mode={pricing.mode} slotsLeft={pricing.slotsLeft} devToggle={pricing.devToggle || isAdminEmail(user?.email)} loggedIn={!!user} />
          </div>
        </section>
      </main>
    </>
  );
}
