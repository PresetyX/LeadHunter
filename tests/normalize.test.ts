import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhoneBR, isMobileBR, dedupeLeads, emptyLead, normalizeUrl, classifySocial } from "../lib/normalize.ts";
import { extractFromHtml } from "../lib/enrich.ts";
import { buildNicheQuery } from "../lib/niches.ts";
import { leadsToCsv } from "../lib/csv.ts";

test("formatPhoneBR — variações comuns", () => {
  assert.equal(formatPhoneBR("(19) 99876-5432"), "5519998765432");
  assert.equal(formatPhoneBR("+55 19 99876-5432"), "5519998765432");
  assert.equal(formatPhoneBR("+55 19 3875-1234"), "551938751234");
  assert.equal(formatPhoneBR("019 99876-5432"), "5519998765432");
  assert.equal(formatPhoneBR("0 15 19 99876-5432"), "5519998765432");
  assert.equal(formatPhoneBR("19 9876-5432"), "5519998765432"); // celular antigo ganha o 9
  assert.equal(formatPhoneBR("99876-5432", "19"), "5519998765432");
  assert.equal(formatPhoneBR("+55 19 3875-1234; +55 19 99999-0000"), "551938751234");
  assert.equal(formatPhoneBR("0800 123 4567"), "");
  assert.equal(formatPhoneBR("abc"), "");
});

test("isMobileBR", () => {
  assert.ok(isMobileBR("5519998765432"));
  assert.ok(!isMobileBR("551938751234"));
});

test("normalizeUrl e redes", () => {
  assert.equal(normalizeUrl("www.exemplo.com.br/?utm_source=x"), "https://www.exemplo.com.br");
  assert.deepEqual(classifySocial("https://wa.me/5519998765432"), { whatsapp: "5519998765432" });
  assert.deepEqual(classifySocial("https://instagram.com/clinica"), { instagram: "https://instagram.com/clinica" });
});

test("dedupeLeads funde por telefone e por nome+endereço", () => {
  const a = emptyLead({ id: "1", nome: "Clínica Bella", fonte: "openstreetmap", telefone: "5519998765432" });
  const b = emptyLead({ id: "2", nome: "Clinica Bella Ltda", fonte: "openstreetmap", telefone: "5519998765432", email: "oi@bella.com" });
  const c = emptyLead({ id: "3", nome: "Studio X", fonte: "openstreetmap", endereco: "Rua A, 10" });
  const d = emptyLead({ id: "4", nome: "Studio X", fonte: "openstreetmap", endereco: "Rua A, 10", website: "https://studiox.com" });
  const out = dedupeLeads([a, b, c, d]);
  assert.equal(out.length, 2);
  const bella = out.find((l) => l.nome.includes("Bella"))!;
  assert.equal(bella.email, "oi@bella.com");
  assert.equal(out.find((l) => l.nome === "Studio X")!.website, "https://studiox.com");
});

test("extractFromHtml encontra e-mail, redes e WhatsApp", () => {
  const html = `
    <a href="mailto:contato@bella.com.br">fale</a> <img src="logo@2x.png">
    <a href="https://www.instagram.com/clinicabella/">ig</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="https://facebook.com/clinicabella">fb</a>
    <a href="https://api.whatsapp.com/send?phone=5519998765432&text=oi">wa</a>
    <a href="tel:+551938751234">ligue</a>
    <a href="/contato">Contato</a>`;
  const f = extractFromHtml(html, "https://bella.com.br");
  assert.equal(f.emails[0], "contato@bella.com.br");
  assert.equal(f.instagram, "https://www.instagram.com/clinicabella");
  assert.equal(f.facebook, "https://facebook.com/clinicabella");
  assert.equal(f.whatsapp, "5519998765432");
  assert.deepEqual(f.phones, ["551938751234"]);
  assert.equal(f.contactUrl, "https://bella.com.br/contato");
});

test("buildNicheQuery mapeia nichos para tags OSM", () => {
  const q = buildNicheQuery("Clínicas Estéticas");
  assert.ok(q.tags.some(([k, v]) => k === "shop" && v === "beauty"));
  assert.ok(q.nameRegex.length > 0);
  const r = buildNicheQuery("Imobiliárias");
  assert.ok(r.tags.some(([k, v]) => k === "office" && v === "estate_agent"));
});

test("CSV tem BOM, ';' e telefone protegido", () => {
  const csv = leadsToCsv([emptyLead({ id: "1", nome: "A; B", fonte: "openstreetmap", telefone: "5519998765432", avaliacao: 4.5 })]);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes('"A; B"'));
  assert.ok(csv.includes('="5519998765432"'));
  assert.ok(csv.includes("4,5"));
});
