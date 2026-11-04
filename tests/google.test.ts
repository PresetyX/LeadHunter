import { test } from "node:test";
import assert from "node:assert/strict";
import { searchGoogle } from "../lib/sources/google.ts";
import { googleQueryVariants } from "../lib/niches.ts";
import { Deadline } from "../lib/http.ts";

/** Simula a API: cada consulta (texto + retângulo) tem um "universo" de lugares, servido em páginas de 20. */
function mockGoogle(sizeFor: (query: string, rect: unknown) => number) {
  const calls: { q: string; rect: unknown }[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ q: body.textQuery, rect: body.locationRestriction ?? null });
    const key = body.textQuery + JSON.stringify(body.locationRestriction ?? null);
    const total = Math.min(60, sizeFor(body.textQuery, body.locationRestriction));
    const page = body.pageToken ? Number(body.pageToken) : 0;
    const start = page * 20;
    const places = Array.from({ length: Math.max(0, Math.min(20, total - start)) }, (_, i) => ({
      id: `${key}#${start + i}`.replace(/\W/g, "").slice(-40) + (start + i),
      displayName: { text: `Clínica ${start + i}` },
      formattedAddress: `Rua X, ${start + i} - Centro, Jundiaí - SP`,
      nationalPhoneNumber: "(11) 4521-0000",
      businessStatus: "OPERATIONAL",
    }));
    const next = start + 20 < total ? String(page + 1) : undefined;
    return new Response(JSON.stringify({ places, ...(next ? { nextPageToken: next } : {}) }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("sinônimos de dentista", () => {
  assert.deepEqual(googleQueryVariants("dentistas"), ["dentistas", "dentista", "clínica odontológica"]);
  assert.deepEqual(googleQueryVariants("floricultura"), ["floricultura"]);
});

test("cidade pequena: sem quadrantes, junta os sinônimos", async () => {
  const calls = mockGoogle(() => 25);
  const leads = await searchGoogle("k", "dentista", "Jundiaí, SP", 200, new Deadline(50000), () => {}, [-23.3, -47, -23.1, -46.8]);
  assert.ok(calls.every((c) => c.rect === null));
  assert.equal(leads.length, 75); // 3 consultas x 25 lugares distintos
});

test("cidade grande: divide em quadrantes e respeita o teto de chamadas", async () => {
  process.env.GOOGLE_MAX_CALLS_PER_SEARCH = "18";
  const calls = mockGoogle(() => 60); // tudo lota
  const leads = await searchGoogle("k", "imobiliaria", "Campinas, SP", 200, new Deadline(50000), () => {}, [-23.1, -47.2, -22.7, -46.9]);
  assert.ok(calls.length <= 18, `fez ${calls.length} chamadas`);
  assert.ok(calls.some((c) => c.rect !== null), "deveria usar quadrantes");
  assert.ok(leads.length > 60 && leads.length <= 200);
  assert.equal(new Set(leads.map((l) => l.id)).size, leads.length);
  delete process.env.GOOGLE_MAX_CALLS_PER_SEARCH;
});

test("erro da API (chave inválida) vira exceção", async () => {
  globalThis.fetch = (async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 })) as typeof fetch;
  await assert.rejects(searchGoogle("k", "dentista", "Jundiaí", 60, new Deadline(50000), () => {}, null), /400/);
});
