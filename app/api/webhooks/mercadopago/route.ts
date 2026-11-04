import { NextRequest, after } from "next/server";
import { getPayment, recordPayment, verifyWebhookSignature } from "@/lib/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do Mercado Pago (padrão do skill oficial mp-webhooks):
 * 1) valida x-signature (HMAC-SHA256 do manifesto id/request-id/ts) com MP_WEBHOOK_SECRET;
 * 2) responde 200 imediatamente e processa depois (after);
 * 3) consulta o pagamento na API do Mercado Pago (fonte da verdade) e grava de forma idempotente.
 * Sem MP_WEBHOOK_SECRET o endpoint recusa tudo — não existe caminho sem assinatura.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ error: "webhook não configurado" }, { status: 503 });

  const url = new URL(req.url);
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "corpo inválido" }, { status: 400 });
  }

  const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? "").trim();
  const requestId = req.headers.get("x-request-id");
  if (!dataId || !requestId) return Response.json({ error: "notificação incompleta" }, { status: 400 });

  if (!verifyWebhookSignature(req.headers.get("x-signature"), requestId, dataId, secret)) {
    return Response.json({ error: "assinatura inválida" }, { status: 401 });
  }

  const type = body.type || url.searchParams.get("type") || "";
  if (type !== "payment" || !/^\d{1,20}$/.test(dataId)) return Response.json({ ok: true, ignored: true });

  after(async () => {
    try {
      const payment = await getPayment(dataId);
      if (payment) await recordPayment(payment);
    } catch (e) {
      // o retorno do checkout (/api/checkout/verify) também libera o acesso, então falhas aqui não travam o cliente
      console.error("webhook processing error", dataId, e);
    }
  });

  return Response.json({ ok: true });
}
