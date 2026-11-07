import { emptyLead, formatPhoneBR, normalizeUrl, isSocialUrl, classifySocial, fold } from "../normalize.ts";
import { fetchWithTimeout, Deadline } from "../http.ts";
import { googleQueryVariants } from "../niches.ts";
import type { Lead } from "../types.ts";

/**
 * Google Places API (New) — Text Search. Fonte oficial e estável (não faz scraping do Maps).
 * Fonte principal. Ativada quando PLACES_API_KEY (ou o legado GOOGLE_PLACES_API_KEY) estiver configurada na Vercel.
 *
 * Cada consulta do Google devolve no máximo 60 lugares (3 páginas de 20). Para cobrir uma cidade
 * inteira a busca:
 *   1. roda o nicho e seus sinônimos ("dentista", "clínica odontológica"…) para a cidade toda;
 *   2. se alguma consulta "lotou" (60 resultados), divide o retângulo da cidade em quadrantes e
 *      repete a consulta restrita a cada quadrante — e subdivide de novo os quadrantes que lotarem.
 * Tudo limitado por um teto de chamadas por busca (custo) e pelo prazo da função serverless.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
  "places.location",
  "places.businessStatus",
  "nextPageToken",
].join(",");

/** south, west, north, east */
export type BBox = [number, number, number, number];

interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text: string };
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
}

export class GoogleError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function maxCallsPerSearch(): number {
  const n = Number(process.env.GOOGLE_MAX_CALLS_PER_SEARCH);
  return Number.isFinite(n) && n >= 1 ? Math.min(60, Math.floor(n)) : 18;
}

function splitBox([s, w, n, e]: BBox): BBox[] {
  const mLat = (s + n) / 2;
  const mLon = (w + e) / 2;
  return [
    [s, w, mLat, mLon],
    [s, mLon, mLat, e],
    [mLat, w, n, mLon],
    [mLat, mLon, n, e],
  ];
}

export async function searchGoogle(
  apiKey: string,
  niche: string,
  city: string,
  limit: number,
  deadline: Deadline,
  onStatus: (msg: string) => void,
  bbox: BBox | null,
  /** Reserva uma chamada contra o teto global mensal; falso = teto atingido, não chama o Google. */
  takeCall?: () => Promise<boolean>,
): Promise<Lead[]> {
  const cityName = city.split(",")[0].trim();
  const variants = googleQueryVariants(niche);
  const byId = new Map<string, GPlace>();
  const budget = maxCallsPerSearch();
  let calls = 0;
  let capped = false;

  const canCall = () => calls < budget && !deadline.expired(20000) && byId.size < limit * 1.3;

  /** Uma consulta completa (até 3 páginas). Devolve true se lotou (60 resultados = provavelmente há mais). */
  const runQuery = async (textQuery: string, rect: BBox | null): Promise<boolean> => {
    let pageToken: string | undefined;
    let got = 0;
    for (let page = 0; page < 3; page++) {
      if (!canCall()) return false;
      calls++;
      if (takeCall && !(await takeCall())) {
        capped = true;
        return false;
      }
      const res = await fetchWithTimeout(ENDPOINT, {
        method: "POST",
        timeoutMs: 10000,
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
        body: JSON.stringify({
          textQuery,
          languageCode: "pt-BR",
          regionCode: "BR",
          pageSize: 20,
          ...(rect
            ? { locationRestriction: { rectangle: { low: { latitude: rect[0], longitude: rect[1] }, high: { latitude: rect[2], longitude: rect[3] } } } }
            : {}),
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GoogleError(`Google Places respondeu ${res.status}: ${body.slice(0, 200)}`, res.status);
      }
      const json = (await res.json()) as { places?: GPlace[]; nextPageToken?: string };
      const places = json.places || [];
      got += places.length;
      for (const p of places) if (p.id && !byId.has(p.id)) byId.set(p.id, p);
      onStatus(`Google Places: ${byId.size} estabelecimentos encontrados…`);
      pageToken = json.nextPageToken;
      if (!pageToken || places.length < 20) return got >= 60;
    }
    return got >= 60;
  };

  // 1) nicho + sinônimos na cidade inteira (em paralelo)
  onStatus(`Consultando Google Places para "${niche}" em ${cityName}…`);
  const firstErrors: Error[] = [];
  const saturated = await Promise.all(
    variants.map((v) =>
      runQuery(`${v} em ${city}`, null).catch((e: Error) => {
        firstErrors.push(e);
        return false;
      }),
    ),
  );
  if (!byId.size && firstErrors.length) throw firstErrors[0];
  if (!byId.size && capped) throw new GoogleError("limite mensal de chamadas ao Google atingido", 429);

  // 2) cidade grande: divide em quadrantes enquanto as consultas lotarem
  if (bbox && saturated.some(Boolean) && byId.size < limit) {
    let queue: BBox[] = splitBox(bbox);
    for (let depth = 0; depth < 2 && queue.length && canCall() && !capped; depth++) {
      onStatus(`Cidade grande: varrendo ${queue.length} regiões de ${cityName}…`);
      const next: BBox[] = [];
      for (let i = 0; i < queue.length && canCall(); i += 4) {
        const batch = queue.slice(i, i + 4);
        const full = await Promise.all(batch.map((box) => runQuery(variants[0], box).catch(() => false)));
        batch.forEach((box, j) => full[j] && next.push(...splitBox(box)));
      }
      queue = next;
    }
  }
  console.log(`google places: ${calls} chamadas, ${byId.size} lugares (${niche} / ${city})`);

  // Descarta o que claramente é de outra cidade (a busca por retângulo pega as vizinhas na borda).
  const all = [...byId.values()].filter((p) => !p.businessStatus || p.businessStatus === "OPERATIONAL");
  const target = fold(cityName);
  const inCity = all.filter((p) => fold(p.formattedAddress || "").includes(target));
  const chosen = inCity.length >= all.length * 0.3 ? inCity : all;

  return chosen.slice(0, limit).map((p) => {
    const site = normalizeUrl(p.websiteUri);
    const lead = emptyLead({
      id: `g-${p.id}`,
      nome: p.displayName?.text || "",
      fonte: "google_places",
      categoria: p.primaryTypeDisplayName?.text || niche,
      endereco: p.formattedAddress || "",
      cidade: cityName,
      telefone: formatPhoneBR(p.internationalPhoneNumber || p.nationalPhoneNumber),
      website: site && !isSocialUrl(site) ? site : "",
      avaliacao: typeof p.rating === "number" ? p.rating : null,
      totalAvaliacoes: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
    });
    if (site && isSocialUrl(site)) Object.assign(lead, classifySocial(site));
    return lead;
  });
}
