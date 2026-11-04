import { NextRequest } from "next/server";
import { requirePaidUser } from "@/lib/auth";
import { Deadline } from "@/lib/http";
import { searchOSM, geocodeCity, type GeoArea } from "@/lib/sources/osm";
import { searchGoogle } from "@/lib/sources/google";
import { searchOutscraper, OutscraperPending } from "@/lib/sources/outscraper";
import { cacheGet, cacheSet } from "@/lib/cache";
import { takePlacesCall } from "@/lib/places-budget";
import { fold, dedupeLeads } from "@/lib/normalize";
import { enrichLeads } from "@/lib/enrich";
import { store } from "@/lib/store";
import { BLOCK_MESSAGES, consumeLeads, normalizeBilling, releaseSearch, reserveSearch, usageOf } from "@/lib/quota";
import type { Lead, LeadSource, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Margem de segurança: a função precisa responder antes do limite de 60s da Vercel.
const BUDGET_MS = 52_000;
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_MS = 30 * 60 * 1000;

interface CachedSearch {
  leads: Lead[];
  source: LeadSource;
  enriched: number;
}

class SearchCancelled extends Error {
  constructor() {
    super("Busca cancelada.");
  }
}

function clean(s: unknown, max = 80): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f"\\<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function POST(req: NextRequest) {
  const guard = await requirePaidUser(req);
  if ("response" in guard) return guard.response;
  const userId = guard.full.id;

  let body: { niche?: string; city?: string; limit?: number; enrich?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const niche = clean(body.niche);
  const city = clean(body.city);
  const requested = Math.max(5, Math.min(200, Number(body.limit) || 60));
  const enrich = body.enrich !== false;

  if (niche.length < 2 || city.length < 2) {
    return Response.json({ error: "Informe o nicho e a cidade." }, { status: 400 });
  }

  // Cota (atômica): confere plano, saldo de leads e limite diário e já reserva a busca do dia.
  const searchKey = `${fold(niche)}|${fold(city)}|${requested}|${enrich ? 1 : 0}`;
  const db = store();
  let reservation: ReturnType<typeof reserveSearch> | null = null;
  await db.updateUser(userId, (u) => {
    const r = reserveSearch(normalizeBilling(u.billing, u.paid), searchKey, Date.now());
    reservation = r;
    return r.ok && !r.free ? { billing: r.patch } : null;
  });
  const res = reservation as ReturnType<typeof reserveSearch> | null;
  if (!res || !res.ok) {
    const reason = res && !res.ok ? res.reason : "NO_PLAN";
    return Response.json({ error: BLOCK_MESSAGES[reason], code: reason, usage: guard.user.usage }, { status: 402 });
  }
  const free = res.free;
  const limit = Math.max(1, Math.min(requested, res.maxLeads));

  const started = Date.now();
  const deadline = new Deadline(BUDGET_MS);
  const encoder = new TextEncoder();
  // "Parar" no navegador: o cliente fecha a conexão e a busca precisa parar de verdade aqui,
  // sem gastar API, sem enriquecer sites e sem debitar leads que ninguém recebeu.
  req.signal.addEventListener("abort", () => deadline.cancel());
  const stopIfCancelled = () => {
    if (deadline.cancelled) throw new SearchCancelled();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          /* cliente desconectou */
        }
      };
      const status = (message: string, progress: number) => send({ type: "status", message, progress });

      /** Debita os leads entregues (ou devolve a busca do dia, se nada foi entregue) e devolve o uso atualizado. */
      const settle = async (delivered: number, fromCache = false) => {
        const now = Date.now();
        const u = await db
          .updateUser(userId, (cur) => {
            const b = normalizeBilling(cur.billing, cur.paid);
            // repetição grátis só quando sai do cache (sem custo de API); se não, cobra normalmente
            if (free && fromCache) return { billing: consumeLeads(b, 0, searchKey, now) };
            if (free) return delivered ? { billing: consumeLeads(b, delivered, searchKey, now) } : null;
            return { billing: delivered ? consumeLeads(b, delivered, searchKey, now) : releaseSearch(b, now) };
          })
          .catch((e) => {
            console.error("quota settle error", e);
            return null;
          });
        return u ? usageOf(normalizeBilling(u.billing, u.paid), now) : undefined;
      };

      let delivered = 0;
      // leads já enviados à tela (resultado parcial): quem os viu tem de pagar por eles, mesmo que pare a busca
      let shown = 0;
      try {
        const cacheKey = `search:v4:${fold(niche)}|${fold(city)}|${limit}|${enrich ? 1 : 0}`;
        const cached = await cacheGet<CachedSearch>(cacheKey, CACHE_MS);
        if (cached?.leads.length) {
          status("Resultado recente encontrado — carregando sem consultar a API…", 90);
          delivered = cached.leads.length;
          const usage = await settle(delivered, true);
          send({ type: "result", leads: cached.leads, source: cached.source, elapsedMs: Date.now() - started, enriched: cached.enriched, usage, free });
          return;
        }

        const placesKey = (process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
        const scraperKey = process.env.SCRAPER_API_KEY?.trim();
        let source: LeadSource = "openstreetmap";
        let raw: Lead[] = [];

        // 1) Google Places API (fonte principal, oficial)
        let area: GeoArea | null = null;
        if (placesKey) {
          status(`Localizando "${city}"…`, 15);
          area = await geocodeCity(city).catch(() => null); // só serve para dividir cidades grandes em regiões
          stopIfCancelled();
          try {
            raw = await searchGoogle(placesKey, niche, city, limit, deadline, (m) => status(m, 20), area?.bbox ?? null, takePlacesCall);
            source = "google_places";
          } catch (e) {
            stopIfCancelled();
            console.error("google places error", e);
            status(`Google Places indisponível (${(e as Error).message.slice(0, 80)}). Tentando alternativa…`, 15);
          }
        }

        // 2) Outscraper (opcional, só se configurado e o Google não trouxe nada)
        stopIfCancelled();
        if (!raw.length && scraperKey) {
          const pendingKey = `pending:${cacheKey}`;
          const pending = await cacheGet<{ id: string }>(pendingKey, PENDING_MS);
          try {
            raw = await searchOutscraper(scraperKey, niche, city, limit, deadline, (m) => status(m, 20), pending?.id, (id) =>
              cacheSet(pendingKey, { id }),
            );
            source = "outscraper";
          } catch (e) {
            stopIfCancelled(); // cancelado: o pedido já enviado fica salvo e a próxima busca igual o retoma sem cobrar de novo
            if (e instanceof OutscraperPending) throw e; // pedido pago em andamento: não gasta outra fonte
            console.error("outscraper error", e);
            status(`Provedor secundário indisponível (${(e as Error).message.slice(0, 80)}). Usando OpenStreetMap…`, 15);
          }
        }

        // 3) OpenStreetMap (último recurso, gratuito)
        stopIfCancelled();
        if (!raw.length && !area && !placesKey) {
          status(`Localizando "${city}"…`, 15);
          area = await geocodeCity(city);
        }
        if (!raw.length && !deadline.expired(20000)) {
          raw = await searchOSM(niche, city, limit, deadline, (m) => status(m, 20), area);
          source = "openstreetmap";
        }

        stopIfCancelled();
        status(`${raw.length} estabelecimentos encontrados. Removendo duplicatas…`, 40);
        let leads = dedupeLeads(raw).slice(0, limit);
        shown = leads.length;
        send({ type: "partial", leads });

        let enriched = 0;
        if (enrich && leads.length) {
          const withSite = leads.filter((l) => l.website).length;
          status(`Enriquecendo ${withSite} sites (e-mail, redes sociais, WhatsApp)…`, 45);
          let lastSent = 0;
          enriched = await enrichLeads(leads, deadline, (done, total) => {
            const pct = 45 + Math.round((done / Math.max(total, 1)) * 50);
            status(`Analisando sites: ${done}/${total}`, pct);
            if (Date.now() - lastSent > 2500) {
              lastSent = Date.now();
              send({ type: "partial", leads });
            }
          });
          if (deadline.expired(1500)) status("Tempo limite próximo — enviando o que já foi enriquecido.", 96);
        }

        stopIfCancelled(); // não grava no cache nem debita leads de uma busca interrompida (enriquecimento incompleto)
        leads = dedupeLeads(leads);
        // guarda o resultado bruto da API mesmo se o enriquecimento parou no tempo: o que custa é a API
        if (leads.length) await cacheSet(cacheKey, { leads, source, enriched } satisfies CachedSearch);
        delivered = leads.length;
        const usage = await settle(delivered);
        status("Concluído.", 100);
        send({ type: "result", leads, source, elapsedMs: Date.now() - started, enriched, usage, free: false });
      } catch (e) {
        // nada mostrado ainda → devolve a busca reservada do dia; já mostrado → cobra os leads exibidos
        if (!delivered) await settle(shown);
        if (!(e instanceof SearchCancelled)) send({ type: "error", message: (e as Error).message || "Erro inesperado na busca." });
      } finally {
        try {
          controller.close();
        } catch {
          /* já encerrado pelo cancelamento */
        }
      }
    },
    cancel() {
      deadline.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
