import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPurchase,
  consumeLeads,
  dayKeyOf,
  emptyBilling,
  hasAccess,
  normalizeBilling,
  releaseSearch,
  reserveSearch,
  revokePurchase,
  usageOf,
} from "../lib/quota.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-03T15:00:00Z");

test("vitalício: 1.000 leads, 10 buscas/dia, e trava quando acaba", () => {
  let b = applyPurchase(emptyBilling(), "lifetime", "p1", T0);
  assert.ok(hasAccess(b, T0));
  assert.equal(usageOf(b, T0).leadsRemaining, 1000);
  // compra repetida (webhook + retorno) não duplica
  assert.deepEqual(applyPurchase(b, "lifetime", "p1", T0), b);

  for (let i = 0; i < 10; i++) {
    const r = reserveSearch(b, "k" + i, T0);
    assert.ok(r.ok, "busca " + i);
    b = consumeLeads(r.ok ? r.patch : b, 60, "k" + i, T0);
  }
  const eleventh = reserveSearch(b, "k10", T0);
  assert.ok(!eleventh.ok && eleventh.reason === "DAILY_LIMIT");
  // no dia seguinte libera de novo
  assert.ok(reserveSearch(b, "k10", T0 + DAY).ok);

  b = consumeLeads(b, 5000, "big", T0 + DAY);
  assert.equal(usageOf(b, T0 + DAY).leadsRemaining, 0);
  const blocked = reserveSearch(b, "novo", T0 + DAY);
  assert.ok(!blocked.ok && blocked.reason === "QUOTA_EXCEEDED");
});

test("pacote de créditos soma +1.000 e o estorno desfaz", () => {
  let b = applyPurchase(emptyBilling(), "lifetime", "p1", T0);
  b = consumeLeads(b, 1000, "a", T0);
  b = applyPurchase(b, "credits_1000", "p2", T0);
  assert.equal(usageOf(b, T0).leadsRemaining, 1000);
  b = revokePurchase(b, "credits_1000", "p2", T0);
  assert.equal(usageOf(b, T0).leadsRemaining, 0);
  assert.ok(!b.granted.includes("p2"));
});

test("repetir a mesma busca em 7 dias não consome cota nem busca do dia", () => {
  let b = applyPurchase(emptyBilling(), "lifetime", "p1", T0);
  const r = reserveSearch(b, "dentista|jundiai", T0);
  assert.ok(r.ok && !r.free);
  b = consumeLeads(r.ok ? r.patch : b, 80, "dentista|jundiai", T0);
  const again = reserveSearch(b, "dentista|jundiai", T0 + 1000);
  assert.ok(again.ok && again.free);
  const later = reserveSearch(b, "dentista|jundiai", T0 + 8 * DAY);
  assert.ok(later.ok && !later.free);
});

test("busca que falha devolve a busca do dia", () => {
  const b = applyPurchase(emptyBilling(), "lifetime", "p1", T0);
  const r = reserveSearch(b, "x", T0);
  assert.ok(r.ok);
  const patched = r.ok ? r.patch : b;
  assert.equal(usageOf(patched, T0).searchesToday, 1);
  assert.equal(usageOf(releaseSearch(patched, T0), T0).searchesToday, 0);
});

test("plano mensal: limite do ciclo, renovação, ciclo novo e expiração", () => {
  let b = applyPurchase(emptyBilling(), "basic", "m1", T0);
  let u = usageOf(b, T0);
  assert.equal(u.mode, "monthly");
  assert.equal(u.leadsRemaining, 1000);
  assert.equal(u.searchesLimit, 20);

  b = consumeLeads(b, 1000, "a", T0);
  assert.equal(usageOf(b, T0).leadsRemaining, 0);
  // renovou antes de vencer: estende 30 dias, mesmo ciclo
  b = applyPurchase(b, "basic", "m2", T0 + 10 * DAY);
  assert.equal(Date.parse(b.planUntil!), T0 + 60 * DAY);
  // ciclo seguinte zera o uso
  assert.equal(usageOf(b, T0 + 31 * DAY).leadsRemaining, 1000);
  // depois de vencer, sem acesso
  assert.ok(!hasAccess(b, T0 + 61 * DAY));
});

test("Pro dá 4.500/mês; Business é ilimitado com fair use; upgrade reinicia o ciclo", () => {
  let b = applyPurchase(emptyBilling(), "pro", "m1", T0);
  assert.equal(usageOf(b, T0).leadsRemaining, 4500);
  b = consumeLeads(b, 4000, "a", T0);
  b = applyPurchase(b, "business", "m2", T0 + DAY);
  const u = usageOf(b, T0 + DAY);
  assert.ok(u.unlimited);
  assert.equal(u.leadsUsed, 0);
  assert.equal(u.leadsLimit, 30000);
});

test("mensal consome o ciclo antes do saldo vitalício", () => {
  let b = applyPurchase(emptyBilling(), "lifetime", "p1", T0);
  b = applyPurchase(b, "basic", "m1", T0);
  b = consumeLeads(b, 1200, "a", T0);
  assert.equal(b.periodUsed, 1000);
  assert.equal(b.lifetimeUsed, 200);
});

test("usuário antigo que já pagou vira vitalício com 1.000 leads", () => {
  const b = normalizeBilling(null, true);
  assert.ok(b.lifetime);
  assert.equal(usageOf(b, T0).leadsRemaining, 1000);
  assert.ok(!hasAccess(normalizeBilling(null, false), T0));
});

test("dia contado no horário de Brasília", () => {
  assert.equal(dayKeyOf(Date.parse("2026-11-04T02:30:00Z")), "2026-11-03"); // 23:30 em Brasília
  assert.equal(dayKeyOf(Date.parse("2026-11-04T03:30:00Z")), "2026-11-04");
});
