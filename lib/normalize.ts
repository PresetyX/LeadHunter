import type { Lead } from "./types.ts";

/** Remove acentos e baixa a caixa: "Clínicas Estéticas" -> "clinicas esteticas" */
export function fold(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Normaliza um telefone brasileiro para o padrão 55 + DDD + número (somente dígitos).
 * Ex.: "(19) 99876-5432" -> "5519998765432"; "+55 19 3875-1234" -> "551938751234".
 * Celulares antigos de 8 dígitos (6-9 inicial) ganham o nono dígito.
 * Retorna "" quando não for possível montar um número válido.
 */
export function formatPhoneBR(raw: string | null | undefined, defaultDDD = ""): string {
  if (!raw) return "";
  // pega só o primeiro número quando vierem vários ("; " ou "/")
  const first = String(raw).split(/[;,/|]| ou /i)[0];
  let d = first.replace(/\D/g, "");
  if (!d) return "";

  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // 0 + operadora(2) + DDD + número (13/14 dígitos) ou 0 + DDD + número (11/12 dígitos)
  if (d.startsWith("0") && (d.length === 13 || d.length === 14)) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);

  // números sem DDD
  if ((d.length === 8 || d.length === 9) && /^\d{2}$/.test(defaultDDD)) d = defaultDDD + d;

  if (d.length === 10) {
    const ddd = d.slice(0, 2);
    const local = d.slice(2);
    // celular sem o nono dígito
    if (/^[6-9]/.test(local)) d = ddd + "9" + local;
  }

  if (d.length !== 10 && d.length !== 11) return "";
  if (!/^[1-9][1-9]/.test(d)) return ""; // DDD válido não tem zero
  if (d.length === 11 && d[2] !== "9") return "";
  return "55" + d;
}

/** Celular brasileiro (55 + DDD + 9XXXXXXXX) — candidato natural a WhatsApp. */
export function isMobileBR(formatted: string): boolean {
  return /^55[1-9][1-9]9\d{8}$/.test(formatted);
}

export function normalizeUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  let u = String(raw).trim();
  if (!u) return "";
  if (u.startsWith("//")) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const url = new URL(u);
    if (!url.hostname.includes(".")) return "";
    url.hash = "";
    // remove rastreadores comuns
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((p) =>
      url.searchParams.delete(p),
    );
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const SOCIAL_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "linktr.ee",
  "wa.me",
  "api.whatsapp.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "google.com",
  "goo.gl",
];

/** Websites que na verdade são perfis de redes sociais não devem virar "site oficial". */
export function isSocialUrl(url: string): boolean {
  const d = domainOf(url);
  return SOCIAL_DOMAINS.some((s) => d === s || d.endsWith("." + s));
}

/** Coloca um perfil social no campo certo quando ele veio como "website". */
export function classifySocial(url: string): Partial<Pick<Lead, "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube" | "whatsapp">> {
  const d = domainOf(url);
  if (d.endsWith("instagram.com")) return { instagram: url };
  if (d.endsWith("facebook.com") || d === "fb.com") return { facebook: url };
  if (d.endsWith("linkedin.com")) return { linkedin: url };
  if (d.endsWith("tiktok.com")) return { tiktok: url };
  if (d.endsWith("youtube.com")) return { youtube: url };
  if (d === "wa.me" || d.endsWith("whatsapp.com")) {
    const m = url.match(/(?:wa\.me\/|phone=)(\d{10,13})/);
    const phone = m ? formatPhoneBR(m[1]) : "";
    return phone ? { whatsapp: phone } : {};
  }
  return {};
}

function nameKey(name: string): string {
  return fold(name)
    .replace(/\b(ltda|me|eireli|epp|s\/?a|clinica|clinicas)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function addressKey(addr: string): string {
  return fold(addr).replace(/[^a-z0-9]/g, "").slice(0, 24);
}

/** Pontua quanto um lead está preenchido — usado para escolher o melhor registro entre duplicatas. */
function score(l: Lead): number {
  return (
    (l.telefone ? 3 : 0) +
    (l.website ? 2 : 0) +
    (l.email ? 2 : 0) +
    (l.avaliacao != null ? 1 : 0) +
    (l.endereco ? 1 : 0) +
    (l.instagram ? 1 : 0) +
    (l.whatsapp ? 1 : 0)
  );
}

function merge(a: Lead, b: Lead): Lead {
  const [best, other] = score(a) >= score(b) ? [a, b] : [b, a];
  const out: Lead = { ...best };
  (Object.keys(other) as (keyof Lead)[]).forEach((k) => {
    const v = out[k];
    if ((v === "" || v === null || v === undefined) && other[k] !== "" && other[k] != null) {
      (out as unknown as Record<string, unknown>)[k] = other[k];
    }
  });
  return out;
}

/**
 * Remove duplicatas usando três chaves independentes (telefone, domínio do site e nome+endereço)
 * e funde os campos dos registros repetidos, mantendo o mais completo.
 */
export function dedupeLeads(leads: Lead[]): Lead[] {
  const result: Lead[] = [];
  const index = new Map<string, number>();

  for (const lead of leads) {
    if (!lead.nome?.trim()) continue;
    const keys: string[] = [];
    if (lead.telefone) keys.push("t:" + lead.telefone);
    if (lead.website && !isSocialUrl(lead.website)) keys.push("w:" + domainOf(lead.website) + ":" + nameKey(lead.nome).slice(0, 6));
    keys.push("n:" + nameKey(lead.nome) + ":" + addressKey(lead.endereco));
    if (!lead.endereco) keys.push("n:" + nameKey(lead.nome));

    const hit = keys.map((k) => index.get(k)).find((i) => i !== undefined);
    if (hit !== undefined) {
      result[hit] = merge(result[hit], lead);
      keys.forEach((k) => index.set(k, hit));
      if (result[hit].telefone) index.set("t:" + result[hit].telefone, hit);
    } else {
      const i = result.push(lead) - 1;
      keys.forEach((k) => index.set(k, i));
    }
  }

  return result.sort((a, b) => score(b) - score(a) || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function emptyLead(partial: Partial<Lead> & Pick<Lead, "id" | "nome" | "fonte">): Lead {
  return {
    categoria: "",
    endereco: "",
    cidade: "",
    telefone: "",
    whatsapp: "",
    website: "",
    avaliacao: null,
    totalAvaliacoes: null,
    email: "",
    instagram: "",
    facebook: "",
    linkedin: "",
    tiktok: "",
    youtube: "",
    latitude: null,
    longitude: null,
    ...partial,
  };
}
