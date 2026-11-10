import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPlaces, searchOutscraper, OutscraperPending } from "../lib/sources/outscraper.ts";
import { Deadline } from "../lib/http.ts";

const sample = [
  [
    { name: "Odonto Prime", place_id: "A", full_address: "Rua X, 10 - Centro, Jundiaí - SP, 13201-000", city: "Jundiaí", phone: "+55 11 4521-1234", site: "https://odontoprime.com.br/", rating: 4.8, reviews: 120, business_status: "OPERATIONAL", category: "Dentista" },
    { name: "Odonto Prime", place_id: "A", full_address: "dup", city: "Jundiaí" },
    { name: "Clínica Fechada", place_id: "B", city: "Jundiaí", business_status: "CLOSED_PERMANENTLY" },
    { name: "Sorriso", place_id: "C", full_address: "Av Y, Jundiaí - SP", city: "Jundiaí", phone: "(11) 98765-4321", site: "https://instagram.com/sorriso" },
  ],
];

test("mapPlaces: converte, remove duplicata e fechados, formata telefone e separa redes", () => {
  const leads = mapPlaces(sample, "dentista", "Jundiaí", 50);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].telefone, "551145211234");
  assert.equal(leads[0].fonte, "outscraper");
  assert.equal(leads[0].avaliacao, 4.8);
  assert.equal(leads[1].telefone, "5511987654321");
  assert.equal(leads[1].website, "");
  assert.match(leads[1].instagram, /instagram\.com\/sorriso/);
});

test("searchOutscraper: assíncrono — envia, consulta até ficar pronto", async () => {
  const urls: string[] = [];
  let polls = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(url);
    assert.equal((init.headers as Record<string, string>)["X-API-KEY"], "chave");
    if (url.includes("/maps/search-v3")) return new Response(JSON.stringify({ id: "req-1", status: "Pending" }));
    polls++;
    return new Response(JSON.stringify(polls < 2 ? { id: "req-1", status: "Pending" } : { id: "req-1", status: "Success", data: sample }));
  }) as typeof fetch;
  let submitted = "";
  const leads = await searchOutscraper("chave", "dentista", "Jundiaí, SP", 50, new Deadline(50000), () => {}, null, (id) => {
    submitted = id;
  });
  assert.equal(submitted, "req-1");
  assert.equal(leads.length, 2);
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get("query"), "dentista, Jundiaí, SP, Brasil");
  assert.equal(q.get("async"), "true");
  assert.equal(q.get("limit"), "50");
});

test("searchOutscraper: sem tempo, devolve o id para retomar depois (sem pagar de novo)", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ id: "req-9", status: "Pending" }))) as typeof fetch;
  await assert.rejects(
    searchOutscraper("chave", "dentista", "Jundiaí", 50, new Deadline(17000), () => {}, "req-9"),
    (e: unknown) => e instanceof OutscraperPending && e.requestId === "req-9",
  );
});

test("searchOutscraper: chave inválida vira erro claro", async () => {
  globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;
  await assert.rejects(searchOutscraper("x", "dentista", "Jundiaí", 50, new Deadline(50000), () => {}), /SCRAPER_API_KEY/);
});
