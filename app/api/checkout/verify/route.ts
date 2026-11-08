import { NextRequest } from "next/server";
import { getCurrentUser, rateLimit, sameOrigin } from "@/lib/auth";
import { getPayment, parseExternalRef, recordPayment } from "@/lib/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chamado pelo painel quando o comprador volta do Mercado Pago com ?payment_id=…
 * Garante a liberação mesmo se o webhook atrasar. O pagamento é consultado na API do
 * Mercado Pago e precisa pertencer ao usuário logado (external_reference começa com o id dele).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const user = await getCurrentUser().catch(() => null);
  if (!user) return Response.json({ error: "Faça login." }, { status: 401 });
  if (!rateLimit("verify:" + user.id, 40, 10 * 60 * 1000)) {
    return Response.json({ paid: false, error: "Muitas verificações. Aguarde." }, { status: 429 });
  }

  const { paymentId } = (await req.json().catch(() => ({}))) as { paymentId?: unknown };
  const id = String(paymentId ?? "");
  if (!/^\d{1,20}$/.test(id)) return Response.json({ paid: false }, { status: 400 });

  try {
    const payment = await getPayment(id);
    const ref = payment ? parseExternalRef(payment.external_reference) : null;
    if (!payment || !ref || ref.userId !== user.id) {
      return Response.json({ paid: false, error: "Pagamento não encontrado para esta conta." }, { status: 404 });
    }
    const granted = await recordPayment(payment);
    return Response.json({ paid: granted, status: payment.status, product: ref.product });
  } catch (e) {
    return Response.json({ paid: false, error: (e as Error).message }, { status: 502 });
  }
}
