import { buildNicheQuery } from "../niches.ts";
import { emptyLead, formatPhoneBR, normalizeUrl, isSocialUrl, classifySocial } from "../normalize.ts";
import { fetchWithTimeout, Deadline } from "../http.ts";
import type { Lead } from "../types.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export interface GeoArea {
  areaId: number | null;
  bbox: [number, number, number, number] | null; // south, west, north, east
  displayName: string;
  ddd: string;
}

/** DDDs das principais cidades — usado quando o telefone vem sem DDD. */
const DDD_BY_STATE_CITY: Record<string, string> = {
  campinas: "19", indaiatuba: "19", jundiai: "11", piracicaba: "19", limeira: "19", americana: "19",
  sumare: "19", hortolandia: "19", valinhos: "19", vinhedo: "19", paulinia: "19", "santa barbara d'oeste": "19",
  "sao paulo": "11", guarulhos: "11", osasco: "11", "santo andre": "11", "sao bernardo do campo": "11",
  sorocaba: "15", "ribeirao preto": "16", "sao carlos": "16", araraquara: "16", bauru: "14", santos: "13",
  "sao jose dos campos": "12", "rio de janeiro": "21", niteroi: "21", "belo horizonte": "31", curitiba: "41",
  "porto alegre": "51", florianopolis: "48", brasilia: "61", salvador: "71", recife: "81", fortaleza: "85",
  goiania: "62", manaus: "92", belem: "91", vitoria: "27", natal: "84", "joao pessoa": "83", maceio: "82",
  "campo grande": "67", cuiaba: "65", londrina: "43", maringa: "44", "uberlandia": "34", "juiz de fora": "32",
};

function guessDDD(city: string): string {
  const k = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(",")[0].trim();
  return DDD_BY_STATE_CITY[k] || "";
}

export async function geocodeCity(city: string): Promise<GeoArea> {
  const params = new URLSearchParams({
    q: city,
    format: "jsonv2",
    limit: "5",
    countrycodes: "br",
    addressdetails: "0",
    "accept-language": "pt-BR",
  });
  const res = await fetchWithTimeout(`${NOMINATIM}?${params}`, { timeoutMs: 8000 }).catch((e: Error) => {
    throw new Error(`Não consegui acessar o serviço de mapas (Nominatim): ${e.name === "AbortError" ? "tempo esgotado" : e.message}.`);
  });
  if (!res.ok) throw new Error(`Falha ao localizar a cidade (Nominatim ${res.status}).`);
  const data = (await res.json()) as Array<{
    osm_type: string;
    osm_id: number;
    boundingbox: [string, string, string, string];
    display_name: string;
    addresstype?: string;
  }>;
  if (!data.length) throw new Error(`Não encontrei "${city}". Tente "Cidade, UF" (ex.: Indaiatuba, SP).`);
  const rel = data.find((d) => d.osm_type === "relation") || data[0];
  const [s, n, w, e] = rel.boundingbox.map(Number);
  return {
    areaId: rel.osm_type === "relation" ? 3600000000 + rel.osm_id : null,
    bbox: [s, w, n, e],
    displayName: rel.display_name,
    ddd: guessDDD(city),
  };
}

function buildOverpassQuery(niche: string, area: GeoArea, limit: number, mode: "tags" | "name"): string | null {
  const { tags, nameRegex } = buildNicheQuery(niche);
  const scope = area.areaId ? "(area.a)" : `(${area.bbox!.join(",")})`;
  const lines: string[] = [];
  if (mode === "tags") {
    for (const [k, v] of tags) {
      lines.push(v === "*" ? `nwr["${k}"]["name"]${scope};` : `nwr["${k}"="${v}"]["name"]${scope};`);
    }
  } else if (nameRegex) {
    // Busca por nome é a parte mais cara: só nós com chave comercial, e só quando as tags trouxeram pouco.
    for (const key of ["shop", "amenity", "office", "healthcare", "craft"]) {
      lines.push(`node["${key}"]["name"~"${nameRegex}",i]${scope};`);
    }
  }
  if (!lines.length) return null;
  return `[out:json][timeout:20][maxsize:33554432];
${area.areaId ? `area(id:${area.areaId})->.a;` : ""}
(
${lines.join("\n")}
);
out center tags ${limit};`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const CATEGORY_PT: Record<string, string> = {
  beauty: "Estética / Beleza", spa: "Spa", estate_agent: "Imobiliária", dentist: "Dentista", clinic: "Clínica",
  doctors: "Consultório médico", doctor: "Consultório médico", physiotherapist: "Fisioterapia", psychotherapist: "Psicologia",
  veterinary: "Veterinário", pet: "Pet shop", pet_grooming: "Banho e tosa", fitness_centre: "Academia",
  restaurant: "Restaurante", fast_food: "Lanchonete", cafe: "Café", bar: "Bar", pub: "Pub", bakery: "Padaria",
  supermarket: "Supermercado", convenience: "Conveniência", pharmacy: "Farmácia", hairdresser: "Salão / Barbearia",
  lawyer: "Advocacia", accountant: "Contabilidade", car_repair: "Oficina mecânica", tyres: "Pneus", car: "Concessionária",
  hotel: "Hotel", guest_house: "Pousada", hostel: "Hostel", school: "Escola", language_school: "Escola de idiomas",
  college: "Faculdade", optician: "Ótica", florist: "Floricultura", clothes: "Loja de roupas", boutique: "Boutique",
  furniture: "Móveis", interior_decoration: "Decoração", hardware: "Material de construção", doityourself: "Home center",
  construction_company: "Construtora", architect: "Arquitetura", engineer: "Engenharia", insurance: "Seguros",
  tattoo: "Estúdio de tatuagem", laundry: "Lavanderia", dry_cleaning: "Lavanderia", copyshop: "Gráfica", printer: "Gráfica",
  travel_agency: "Agência de viagens", advertising_agency: "Agência de publicidade", marketing: "Marketing", it: "Tecnologia",
  computer: "Informática",
};

function categoryOf(t: Record<string, string>, niche: string): string {
  for (const key of ["healthcare", "shop", "amenity", "office", "leisure", "tourism", "craft"]) {
    const v = t[key];
    if (v && v !== "yes") return CATEGORY_PT[v] || v.replace(/_/g, " ");
  }
  if (t.beauty) return "Estética / Beleza";
  return niche;
}

function addressOf(t: Record<string, string>): string {
  if (t["addr:full"]) return t["addr:full"];
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
  const parts = [street, t["addr:suburb"] || t["addr:neighbourhood"], t["addr:city"], t["addr:postcode"]].filter(Boolean);
  return parts.join(" - ");
}

/**
 * Dispara os espelhos do Overpass em corrida (com início escalonado de 1,5s) e usa a primeira
 * resposta válida, cancelando as demais. Antes, os espelhos eram tentados em sequência e um único
 * servidor lento consumia todo o tempo da função ("This operation was aborted").
 */
async function runOverpass(query: string, deadline: Deadline): Promise<OverpassElement[]> {
  const controllers = OVERPASS_MIRRORS.map(() => new AbortController());
  const errors: string[] = [];
  const budget = Math.max(8000, Math.min(24000, deadline.remaining() - 14000));

  const attempt = async (mirror: string, i: number): Promise<OverpassElement[]> => {
    await new Promise((r) => setTimeout(r, i * 1500));
    if (controllers[i].signal.aborted) throw new Error("cancelado");
    const timer = setTimeout(() => controllers[i].abort(), budget - i * 1500);
    try {
      const res = await fetch(mirror, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "LeadHunterBot/1.0 (lead enrichment for local businesses)",
        },
        signal: controllers[i].signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${new URL(mirror).hostname} ${res.status}`);
      const text = await res.text();
      if (!text.trimStart().startsWith("{")) throw new Error(`${new URL(mirror).hostname} resposta inválida`);
      const json = JSON.parse(text) as { elements?: OverpassElement[]; remark?: string };
      if (!json.elements?.length && json.remark && /timed out|out of memory/i.test(json.remark)) {
        throw new Error(`${new URL(mirror).hostname} ${json.remark.slice(0, 60)}`);
      }
      return json.elements || [];
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? `${new URL(mirror).hostname} tempo esgotado` : (e as Error).message;
      errors.push(msg);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const elements = await Promise.any(OVERPASS_MIRRORS.map(attempt));
    controllers.forEach((c) => c.abort());
    return elements;
  } catch {
    throw new Error(
      `Os servidores do OpenStreetMap estão sobrecarregados agora. Tente novamente em alguns segundos ou use uma cidade/nicho mais específico. (${errors.slice(0, 4).join("; ")})`,
    );
  }
}

export async function searchOSM(
  niche: string,
  city: string,
  limit: number,
  deadline: Deadline,
  onStatus: (msg: string) => void,
  area?: GeoArea | null,
): Promise<Lead[]> {
  if (!area) {
    onStatus(`Localizando "${city}" no mapa…`);
    area = await geocodeCity(city);
  }
  const where = area.displayName.split(",").slice(0, 2).join(",");
  onStatus(`Buscando "${niche}" no OpenStreetMap em ${where}…`);
  const max = Math.min(limit * 2, 400);
  let elements: OverpassElement[] = [];
  const byTags = buildOverpassQuery(niche, area, max, "tags");
  let tagError: Error | null = null;
  if (byTags) elements = await runOverpass(byTags, deadline).catch((e: Error) => ((tagError = e), []));
  const byName = buildOverpassQuery(niche, area, max, "name");
  if (byName && elements.length < 15 && !deadline.expired(25000)) {
    onStatus(`Poucos resultados por categoria; procurando "${niche}" pelo nome…`);
    const seen = new Set(elements.map((e) => `${e.type}${e.id}`));
    const extra = await runOverpass(byName, deadline).catch((e: Error) => {
      if (!elements.length) throw tagError || e;
      return [];
    });
    for (const e of extra) if (!seen.has(`${e.type}${e.id}`)) elements.push(e);
  } else if (tagError && !elements.length) {
    throw tagError;
  }
  const cityName = city.split(",")[0].trim();

  return elements
    .filter((el) => el.tags?.name)
    .map((el) => {
      const t = el.tags!;
      const rawSite = t.website || t["contact:website"] || t.url || "";
      const site = normalizeUrl(rawSite);
      const phoneRaw = t.phone || t["contact:phone"] || t["contact:mobile"] || t.mobile || "";
      const waRaw = t["contact:whatsapp"] || t.whatsapp || "";
      const lead = emptyLead({
        id: `osm-${el.type}-${el.id}`,
        nome: t.name,
        fonte: "openstreetmap",
        categoria: categoryOf(t, niche),
        endereco: addressOf(t),
        cidade: t["addr:city"] || cityName,
        telefone: formatPhoneBR(phoneRaw, area.ddd),
        whatsapp: formatPhoneBR(waRaw, area.ddd),
        website: site && !isSocialUrl(site) ? site : "",
        email: (t.email || t["contact:email"] || "").split(/[;,\s]/)[0].toLowerCase(),
        instagram: normalizeUrl(t["contact:instagram"] ? (t["contact:instagram"].includes("/") ? t["contact:instagram"] : `instagram.com/${t["contact:instagram"].replace(/^@/, "")}`) : ""),
        facebook: normalizeUrl(t["contact:facebook"] ? (t["contact:facebook"].includes("/") ? t["contact:facebook"] : `facebook.com/${t["contact:facebook"]}`) : ""),
        linkedin: normalizeUrl(t["contact:linkedin"] || ""),
        tiktok: normalizeUrl(t["contact:tiktok"] || ""),
        youtube: normalizeUrl(t["contact:youtube"] || ""),
        latitude: el.lat ?? el.center?.lat ?? null,
        longitude: el.lon ?? el.center?.lon ?? null,
      });
      if (site && isSocialUrl(site)) Object.assign(lead, Object.fromEntries(Object.entries(classifySocial(site)).filter(([k]) => !(lead as unknown as Record<string, string>)[k])));
      return lead;
    });
}
