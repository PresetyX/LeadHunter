import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar — LeadHunter" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");
  return (
    <>
      <SiteHeader user={null} />
      <main className="px-4 pb-24 pt-10">
        {reason === "expired" && (
          <p className="mx-auto mb-4 max-w-md rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
            Sua sessão foi encerrada (saída, troca de rede, inatividade de 30 min ou acesso por outro dispositivo). Entre novamente.
          </p>
        )}
        <AuthForm mode="login" next={next} />
      </main>
    </>
  );
}
