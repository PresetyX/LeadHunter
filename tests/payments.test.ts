import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isValidApproval, verifyWebhookSignature, type MPPayment } from "../lib/mp-core.ts";

const UID = "3f1c2b9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b";
const base: MPPayment = { id: 123, status: "approved", transaction_amount: 30, currency_id: "BRL", external_reference: UID };

test("isValidApproval só libera pagamento aprovado, em BRL, >= R$30 e com usuário", () => {
  assert.ok(isValidApproval(base));
  assert.ok(!isValidApproval({ ...base, status: "pending" }));
  assert.ok(!isValidApproval({ ...base, transaction_amount: 29.99 }));
  assert.ok(!isValidApproval({ ...base, currency_id: "USD" }));
  assert.ok(!isValidApproval({ ...base, external_reference: "qualquer" }));
  assert.ok(!isValidApproval({ ...base, external_reference: null }));
});

test("verifyWebhookSignature confere o HMAC do Mercado Pago", () => {
  const secret = "segredo-de-teste";
  const ts = "1704908010";
  const reqId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
  const manifest = `id:123456;request-id:${reqId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  assert.ok(verifyWebhookSignature(`ts=${ts},v1=${v1}`, reqId, "123456", secret));
  assert.ok(!verifyWebhookSignature(`ts=${ts},v1=${v1}`, reqId, "999999", secret));
  assert.ok(!verifyWebhookSignature(`ts=${ts},v1=${"0".repeat(64)}`, reqId, "123456", secret));
  assert.ok(!verifyWebhookSignature(null, reqId, "123456", secret));
});

test("pagamento por produto: valor mínimo de cada produto e referência válida", async () => {
  const { parseExternalRef } = await import("../lib/mp-core.ts");
  const ref = (p: string) => `${UID}|${p}`;
  assert.deepEqual(parseExternalRef(ref("pro")), { userId: UID, product: "pro" });
  assert.deepEqual(parseExternalRef(UID), { userId: UID, product: "lifetime" }); // pagamentos antigos
  assert.equal(parseExternalRef(`${UID}|gratis`), null);
  assert.equal(parseExternalRef(`${UID}|pro|x`), null);
  assert.ok(isValidApproval({ ...base, external_reference: ref("credits_1000"), transaction_amount: 15 }));
  assert.ok(!isValidApproval({ ...base, external_reference: ref("credits_1000"), transaction_amount: 14.99 }));
  assert.ok(isValidApproval({ ...base, external_reference: ref("business"), transaction_amount: 149.9 }));
  // não dá para pagar o preço do pacote e levar o Business
  assert.ok(!isValidApproval({ ...base, external_reference: ref("business"), transaction_amount: 15 }));
  assert.ok(!isValidApproval({ ...base, external_reference: ref("pro"), transaction_amount: 59.89 }));
});
