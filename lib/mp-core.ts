import { createHmac, timingSafeEqual } from "node:crypto";
import { PRODUCTS, isProductId, type ProductId } from "./plan.ts";

export interface MPPayment {
  id: number;
  status: "approved" | "pending" | "in_process" | "rejected" | "cancelled" | "refunded" | "charged_back" | "authorized" | string;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  payment_type_id?: string;
  payment_method_id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** external_reference = "<id do usuário>|<produto>". Pagamentos antigos têm só o id (= vitalício). */
export function buildExternalRef(userId: string, product: ProductId): string {
  return `${userId}|${product}`;
}

export function parseExternalRef(ref: unknown): { userId: string; product: ProductId } | null {
  if (typeof ref !== "string") return null;
  const [userId, product = "lifetime", ...rest] = ref.split("|");
  if (rest.length || !UUID.test(userId) || !isProductId(product)) return null;
  return { userId: userId.toLowerCase(), product };
}

/** Regras para liberar: aprovado, em BRL, valor >= preço DO PRODUTO e vinculado a um usuário. */
export function isValidApproval(p: MPPayment): boolean {
  const ref = parseExternalRef(p.external_reference);
  return (
    !!ref &&
    p.status === "approved" &&
    p.currency_id === "BRL" &&
    Number(p.transaction_amount) + 0.001 >= PRODUCTS[ref.product].priceBRL
  );
}

/**
 * Valida o header x-signature do webhook (HMAC-SHA256 com a "assinatura secreta" do painel).
 * Manifesto: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
export function verifyWebhookSignature(signatureHeader: string | null, requestId: string | null, dataId: string, secret: string): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = "";
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
