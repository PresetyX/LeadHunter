import { randomUUID } from "node:crypto";
import { store, ConfigError } from "./store";
import { PRODUCTS, type ProductId } from "./plan";
import { applyPurchase, hasAccess, normalizeBilling, revokePurchase } from "./quota";
import { buildExternalRef, isValidApproval, parseExternalRef, type MPPayment } from "./mp-core";

export { isValidApproval, verifyWebhookSignature, parseExternalRef, type MPPayment } from "./mp-core";

/**
 * Mercado Pago — Checkout Pro (Pix, cartão e boleto).
 * O comprador paga na página do Mercado Pago; o app nunca vê dados de cartão.
 * O acesso é liberado SOMENTE após consultar o pagamento em GET /v1/payments/{id} com o nosso
 * Access Token (no webhook e no retorno do checkout) — nunca com base em parâmetros da URL.
 * Planos mensais são pré-pagos (30 dias por pagamento): funcionam com Pix e cartão.
 */
const API = "https://api.mercadopago.com";

function token(): string {
  const t = process.env.MP_ACCESS_TOKEN?.trim();
  if (!t) throw new ConfigError("Pagamento ainda não configurado (MP_ACCESS_TOKEN ausente).");
  return t;
}

export async function createPreference(
  user: { id: string; email: string; name: string },
  productId: ProductId,
  baseUrl: string,
): Promise<string> {
  if (!baseUrl.startsWith("https://") && process.env.VERCEL) {
    throw new Error("URL do app precisa ser HTTPS para o checkout.");
  }
  const product = PRODUCTS[productId];
  const res = await fetch(`${API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      items: [
        {
          id: `leadhunter-${product.id}`,
          title: product.title,
          description: "LeadHunter — busca, enriquecimento e exportação de leads de empresas locais",
          category_id: "services",
          quantity: 1,
          currency_id: "BRL",
          unit_price: product.priceBRL,
        },
      ],
      payer: { email: user.email, name: user.name },
      external_reference: buildExternalRef(user.id, product.id),
      metadata: { user_id: user.id, product: product.id },
      back_urls: {
        success: `${baseUrl}/dashboard?checkout=success`,
        pending: `${baseUrl}/dashboard?checkout=pending`,
        failure: `${baseUrl}/dashboard?checkout=failure`,
      },
      auto_return: "approved",
      notification_url: `${baseUrl}/api/webhooks/mercadopago?source_news=webhooks`,
      statement_descriptor: "LEADHUNTER",
      payment_methods: { installments: 1 },
      expires: true,
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { init_point?: string; message?: string };
  if (!res.ok || !json.init_point) {
    throw new Error(`Mercado Pago recusou a criação do checkout: ${json.message || res.status}`);
  }
  return json.init_point;
}

export async function getPayment(id: string): Promise<MPPayment | null> {
  if (!/^\d{1,20}$/.test(id)) return null;
  const res = await fetch(`${API}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mercado Pago ${res.status} ao consultar pagamento.`);
  return (await res.json()) as MPPayment;
}

/**
 * Registra o pagamento e concede (ou revoga) o que ele comprou. Idempotente: pode rodar várias
 * vezes para o mesmo pagamento (webhook + retorno do checkout) sem efeitos duplicados.
 */
export async function recordPayment(p: MPPayment): Promise<boolean> {
  const db = store();
  const ref = parseExternalRef(p.external_reference);
  const paymentId = String(p.id);

  await db.savePayment({
    id: paymentId,
    userId: ref?.userId ?? null,
    status: p.status,
    statusDetail: p.status_detail ?? null,
    amount: Number(p.transaction_amount),
    currency: p.currency_id,
    method: p.payment_method_id ?? null,
    updatedAt: new Date().toISOString(),
  });

  if (!ref) return false;
  const now = Date.now();

  if (isValidApproval(p)) {
    await db.updateUser(ref.userId, (u) => {
      const billing = normalizeBilling(u.billing, u.paid);
      if (billing.granted.includes(paymentId)) return null;
      const next = applyPurchase(billing, ref.product, paymentId, now);
      return { billing: next, paid: hasAccess(next, now), paidAt: u.paidAt ?? new Date(now).toISOString(), paymentId };
    });
    if (ref.product === "lifetime") await db.recordSale(paymentId);
    return true;
  }

  // estorno ou chargeback desfaz o que ESTE pagamento concedeu
  if (p.status === "refunded" || p.status === "charged_back" || p.status === "cancelled") {
    await db.updateUser(ref.userId, (u) => {
      const billing = normalizeBilling(u.billing, u.paid);
      // pagamento antigo (antes dos planos): o acesso legado foi concedido por este paymentId
      const legacy = !u.billing && u.paymentId === paymentId;
      if (!billing.granted.includes(paymentId) && !legacy) return null;
      const next = revokePurchase(legacy ? { ...billing, granted: [paymentId] } : billing, ref.product, paymentId, now);
      return { billing: next, paid: hasAccess(next, now) };
    });
    if (ref.product === "lifetime") await db.removeSale(paymentId);
  }
  return false;
}
