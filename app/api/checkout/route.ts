import { NextRequest } from "next/server";
import { getCurrentUser, rateLimit, sameOrigin } from "@/lib/auth";
import { createPreference } from "@/lib/mercadopago";
import { ConfigError } from "@/lib/store";
import { appBaseUrl, isProductId } from "@/lib/plan";
import { pricingState } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cria o checkout do produto escolhido. Quem decide preço e elegibilidade é o servidor:
 * - lifetime: só enquanto houver vagas de lançamento (contagem lida na hora) e uma vez por conta;
 * - credits_1000: só para quem já tem um plano;
 * - basic | pro | business: qualquer conta (30 dias por pagamento, renovável).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Faça login para continuar." }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { product?: unknown };
    const product = body.product ?? "lifetime";
    if (!isProductId(product)) return Response.json({ error: "Plano inválido." }, { status: 400 });

    if (product === "lifetime") {
      if (user.usage.hasLifetime) {
        return Response.json({ error: "Sua conta já tem o vitalício. Para mais leads, adicione um pacote de créditos." }, { status: 409 });
      }
      const pricing = await pricingState(true);
      if (pricing.mode !== "launch") {
        return Response.json({ error: "As vagas do vitalício de lançamento acabaram. Escolha um plano mensal." }, { status: 410 });
      }
    }
    if (product === "credits_1000" && !user.paid) {
      return Response.json({ error: "O pacote de créditos é para quem já tem um plano." }, { status: 409 });
    }

    if (!rateLimit("checkout:" + user.id, 10, 10 * 60 * 1000)) {
      return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
    }
    const url = await createPreference(user, product, appBaseUrl(req.url));
    return Response.json({ url });
  } catch (e) {
    console.error("checkout error", e);
    const status = e instanceof ConfigError ? 503 : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
