import { emptyLead, formatPhoneBR, normalizeUrl, isSocialUrl, classifySocial, fold } from "../normalize.ts";
import { fetchWithTimeout, Deadline } from "../http.ts";
import { googleQueryVariants } from "../niches.ts";
import type { Lead } from "../types.ts";

/**
 * Outscraper — dados do Google Maps via API (https://outscraper.com).
 * Chave em SCRAPER_API_KEY (Vercel → Environment Variables, ou .env.local em desenvolvimento).
 *
 * Fluxo assíncrono: envia o pedido (async=true), recebe um id e consulta /requests/{id} até ficar
 * pronto. Se o prazo da função acabar antes, lança OutscraperPending com o id — a rota guarda esse
 * id e a próxima tentativa da MESMA busca retoma o pedido em vez de pagar por outro.
 */
const API = "https://api.app.outscraper.com";

export class OutscraperPending extends Error {
  readonly requestId: string;
  constructor(requestId: string) {
    super("A busca ainda está sendo processada pelo provedor. Clique em buscar de novo em cerca de 1 minuto — não será cobrada outra vez.");
    this.requestId = requestId;
  }
}

interface OSPlace {
  name?: string;
  place_id?: string;
  google_id?: string;
  full_address?: string;
  address?: string;
  city?: string;
  phone?: string;
  site?: string;
  type?: string;
  category?: string;
  subtypes?: string;
  rating?: number | null;
  reviews?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  business_status?: string;
  email_1?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
}

interface OSResponse {
  id?: string;
  status?: string;
  data?: OSPlace[][] | OSPlace[];
  errorMessage?: string;
}

/** Quantas variações do nicho consultar. Cada variação é cobrada à parte, então o padrão é 1. */
function variantCount(): number {
  const n = Number(process.env.OUTSCRAPER_QUERY_VARIANTS);
  return Number.isFinite(n) && n >= 1 ? Math.min(3, Math.floor(n)) : 1;
}

async function call(apiKey: string, path: string, timeoutMs: number): Promise<OSResponse> {
  const res = await fetchWithTimeout(`${API}${path}`, { timeoutMs, headers: { "X-API-KEY": apiKey, Accept: "application/json" } });
  const text = await res.text();
  let json: OSResponse = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* corpo não-JSON */
  }
  if (res.status === 401 || res.status === 403) throw new Error("Outscraper recusou a chave (SCRAPER_API_KEY inválida ou sem saldo).");
  if (res.status === 402) throw new Error("Sem saldo no Outscraper.");
  if (!res.ok) throw new Error(`Outscraper respondeu ${res.status}: ${(json.errorMessage || text).slice(0, 160)}`);
  return json;
}

export async function searchOutscraper(
  apiKey: string,
  niche: string,
  city: string,
  limit: number,
  deadline: Deadline,
  onStatus: (msg: string) => void,
  resumeRequestId?: string | null,
  onSubmitted?: (requestId: string) => Promise<void> | void,
): Promise<Lead[]> {
  const cityName = city.split(",")[0].trim();
  let requestId = resumeRequestId || "";

  if (!requestId) {
    const params = new URLSearchParams();
    for (const v of googleQueryVariants(niche).slice(0, variantCount())) params.append("query", `${v}, ${city}, Brasil`);
    params.set("limit", String(limit));
    params.set("organizationsPerQueryLimit", String(limit));
    params.set("language", "pt");
    params.set("region", "BR");
    params.set("dropDuplicates", "true");
    params.set("async", "true");
    onStatus(`Enviando busca de "${niche}" em ${cityName} ao provedor de dados…`);
    const sub = await call(apiKey, `/maps/search-v3?${params}`, 15000);
    if (sub.data && sub.status === "Success") return mapPlaces(sub.data, niche, cityName, limit);
    if (!sub.id) throw new Error("Outscraper não devolveu o identificador da busca.");
    requestId = sub.id;
    await onSubmitted?.(requestId);
  } else {
    onStatus("Retomando a busca que ficou em processamento…");
  }

  const started = Date.now();
  while (!deadline.expired(18000)) {
    const r = await call(apiKey, `/requests/${encodeURIComponent(requestId)}`, 10000);
    if (r.status === "Success") return mapPlaces(r.data || [], niche, cityName, limit);
    if (r.status && /fail|error/i.test(r.status)) throw new Error(`Outscraper não concluiu a busca (${r.status}).`);
    onStatus(`Coletando estabelecimentos no Google Maps… (${Math.round((Date.now() - started) / 1000)}s)`);
    await new Promise((res) => setTimeout(res, 2500));
  }
  throw new OutscraperPending(requestId);
}

export function mapPlaces(data: OSPlace[][] | OSPlace[], niche: string, cityName: string, limit: number): Lead[] {
  const flat = (data as unknown[]).flatMap((x) => (Array.isArray(x) ? x : [x])) as OSPlace[];
  const seen = new Set<string>();
  const all = flat.filter((p) => {
    if (!p?.name) return false;
    if (p.business_status && !/operational/i.test(p.business_status)) return false;
    const k = p.place_id || p.google_id || `${p.name}|${p.full_address}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // a busca do Maps às vezes traz cidades vizinhas; prioriza as da cidade pedida
  const target = fold(cityName);
  const inCity = all.filter((p) => fold(`${p.city || ""} ${p.full_address || ""}`).includes(target));
  const chosen = inCity.length >= all.length * 0.3 ? inCity : all;

  return chosen.slice(0, limit).map((p) => {
    const site = normalizeUrl(p.site);
    const lead = emptyLead({
      id: `os-${p.place_id || p.google_id || fold(p.name!).replace(/\W+/g, "-")}`,
      nome: p.name!,
      fonte: "outscraper",
      categoria: p.category || p.type || (p.subtypes || "").split(",")[0] || niche,
      endereco: p.full_address || p.address || "",
      cidade: p.city || cityName,
      telefone: formatPhoneBR(p.phone),
      website: site && !isSocialUrl(site) ? site : "",
      email: (p.email_1 || "").toLowerCase(),
      instagram: normalizeUrl(p.instagram),
      facebook: normalizeUrl(p.facebook),
      linkedin: normalizeUrl(p.linkedin),
      avaliacao: typeof p.rating === "number" ? p.rating : null,
      totalAvaliacoes: typeof p.reviews === "number" ? p.reviews : null,
      latitude: typeof p.latitude === "number" ? p.latitude : null,
      longitude: typeof p.longitude === "number" ? p.longitude : null,
    });
    if (site && isSocialUrl(site)) Object.assign(lead, classifySocial(site));
    return lead;
  });
}
