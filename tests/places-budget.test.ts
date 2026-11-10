import test from "node:test";
import assert from "node:assert/strict";
import { createBudget, monthlyCap, monthKey, DEFAULT_MONTHLY_CAP } from "../lib/places-budget.ts";

const mem = () => {
  const m = new Map<string, number>();
  return { read: async (k: string) => m.get(k) ?? 0, write: async (k: string, v: number) => void m.set(k, v) };
};

test("monthlyCap lê env e cai no padrão", () => {
  assert.equal(monthlyCap(undefined), DEFAULT_MONTHLY_CAP);
  assert.equal(monthlyCap("abc"), DEFAULT_MONTHLY_CAP);
  assert.equal(monthlyCap("50"), 50);
});

test("bloqueia ao atingir o teto, mesmo com chamadas paralelas", async () => {
  const b = createBudget(mem(), 5);
  const r = await Promise.all(Array.from({ length: 8 }, () => b.takeCall()));
  assert.equal(r.filter(Boolean).length, 5);
});

test("zera ao virar o mês", async () => {
  let now = Date.UTC(2026, 10, 30);
  const b = createBudget(mem(), 1, () => now);
  assert.equal(await b.takeCall(), true);
  assert.equal(await b.takeCall(), false);
  now = Date.UTC(2026, 11, 1);
  assert.equal(monthKey(now), "2026-12");
  assert.equal(await b.takeCall(), true);
});

test("leitura falha: não libera além do que a instância contou", async () => {
  const b = createBudget({ read: async () => { throw new Error("x"); }, write: async () => {} }, 2);
  assert.equal(await b.takeCall(), true);
  assert.equal(await b.takeCall(), true);
  assert.equal(await b.takeCall(), false);
});
