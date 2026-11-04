import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta — LeadHunter" };

export default async function RegisterPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");
  return (
    <>
      <SiteHeader user={null} />
      <main className="px-4 pb-24 pt-10">
        <AuthForm mode="register" />
      </main>
    </>
  );
}
