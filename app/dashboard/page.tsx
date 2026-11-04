import { redirect } from "next/navigation";
import LeadDashboard from "@/components/LeadDashboard";
import Paywall, { PaymentReturn } from "@/components/Paywall";
import SiteHeader from "@/components/SiteHeader";
import SessionHeartbeat from "@/components/SessionHeartbeat";
import { getCurrentUser, type PublicUser } from "@/lib/auth";
import { isAdminEmail, pricingState, type PricingState } from "@/lib/pricing";
import { CREDIT_PACK, MONTHLY_BY_ID, isProductId } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Painel — LeadHunter" };

function welcomeText(product?: string): string {
  if (!product || !isProductId(product)) return "Pagamento aprovado — seu acesso está liberado. Boas buscas!";
  if (product === "credits_1000") return `Pagamento aprovado — +${CREDIT_PACK.leads.toLocaleString("pt-BR")} leads adicionados ao seu saldo.`;
  if (product === "lifetime") return "Pagamento aprovado — seu acesso vitalício de lançamento está liberado. Boas buscas!";
  return `Pagamento aprovado — Plano ${MONTHLY_BY_ID[product].name} ativo por 30 dias.`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; payment_id?: string; collection_id?: string; welcome?: string }>;
}) {
  const sp = await searchParams;
  let user: PublicUser | null = null;
  let pricing: PricingState | null = null;
  let configError = "";
  try {
    [user, pricing] = await Promise.all([getCurrentUser(), pricingState()]);
  } catch (e) {
    console.error("dashboard user error", e);
    configError = "Serviço temporariamente indisponível. Tente novamente em instantes.";
  }
  if (configError || !pricing) {
    return <main className="mx-auto max-w-lg px-4 py-24 text-center text-sm text-amber-200">{configError}</main>;
  }
  if (!user) redirect("/login?next=/dashboard&reason=expired");
  const paymentId = sp.payment_id || sp.collection_id;

  if (!user.paid) {
    return (
      <>
        <SessionHeartbeat />
        <SiteHeader user={user} />
        <main className="px-4 pb-24 pt-6">
          <div className="mx-auto mb-8 max-w-lg text-center">
            <h1 className="text-2xl font-semibold text-white">Escolha seu plano para começar</h1>
            <p className="mt-1 text-sm text-zinc-500">Olá, {user.name || user.email}. Pague com Pix ou cartão e o acesso é liberado na hora.</p>
          </div>
          <div className="mx-auto max-w-5xl">
            <Paywall checkout={sp.checkout} paymentId={paymentId} mode={pricing.mode} slotsLeft={pricing.slotsLeft} devToggle={pricing.devToggle || isAdminEmail(user.email)} />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SessionHeartbeat />
      <SiteHeader user={user} />
      {paymentId && (
        <div className="px-4">
          <PaymentReturn checkout={sp.checkout} paymentId={paymentId} />
        </div>
      )}
      {sp.welcome && (
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
          <div className="rounded-xl border border-lime/30 bg-lime/[0.06] px-4 py-3 text-sm text-lime">{welcomeText(sp.welcome)}</div>
        </div>
      )}
      <LeadDashboard initialUsage={user.usage} />
    </>
  );
}
