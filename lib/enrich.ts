import { fetchWithTimeout, pool, Deadline } from "./http.ts";
import { formatPhoneBR, isMobileBR, normalizeUrl, domainOf } from "./normalize.ts";
import type { Lead } from "./types.ts";

const MAX_HTML_BYTES = 700_000;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|avif|css|js)$|@(sentry|wixpress|example|domain|email|seudominio|exemplo|sentry-next)\.|^(no-?reply|user|nome|seu|your)@|u00|%40/i;

const SOCIAL_PATTERNS: Record<"instagram" | "facebook" | "linkedin" | "tiktok" | "youtube", RegExp> = {
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/|sharer)([a-z0-9._]{2,30})\/?/gi,
  facebook: /https?:\/\/(?:www\.|m\.|pt-br\.)?facebook\.com\/(?!sharer|share|plugins|tr\?|dialog|login|events\/|groups\/)([a-z0-9.\-]{2,80})\/?/gi,
  linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/[a-z0-9\-_%]{2,100}\/?/gi,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[a-z0-9._]{2,30}/gi,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w.-]{2,60}|channel\/[\w-]{10,40}|c\/[\w.-]{2,60}|user\/[\w.-]{2,60})/gi,
};

const WA_RE = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s>]*&)?phone=|whatsapp:\/\/send\?phone=)\+?(\d{10,13})/gi;
const TEL_RE = /href=["']tel:([+\d\s().-]{8,20})["']/gi;

/** Bloqueia hosts internos para evitar SSRF a partir de URLs vindas de fontes externas. */
function isSafeHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (u.port && !["80", "443"].includes(u.port)) return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
      const [a, b] = h.split(".").map(Number);
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
    }
    if (h.includes(":")) return false; // IPv6 literal
    return true;
  } catch {
    return false;
  }
}

async function readLimited(res: Response): Promise<string> {
  const type = res.headers.get("content-type") || "";
  if (type && !/html|text|xml/.test(type)) return "";
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, size - off)), off);
    off += c.byteLength;
    if (off >= size) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

export interface PageFindings {
  emails: string[];
  instagram: string;
  facebook: string;
  linkedin: string;
  tiktok: string;
  youtube: string;
  whatsapp: string;
  phones: string[];
  contactUrl: string;
}

/** Extrai e-mails, redes sociais, WhatsApp e telefones de um HTML. Exportada para testes. */
export function extractFromHtml(html: string, baseUrl: string, ddd = ""): PageFindings {
  const decoded = html
    .replace(/&#64;|&commat;|\[at\]|\(at\)| at /gi, "@")
    .replace(/&#46;|\[dot\]|\(dot\)/gi, ".")
    .replace(/\\u0040/g, "@")
    .replace(/\\\//g, "/");

  const siteDomain = domainOf(baseUrl);
  const emails = [...new Set((decoded.match(EMAIL_RE) || []).map((e) => e.toLowerCase().replace(/^mailto:/, "")))]
    .filter((e) => !BAD_EMAIL.test(e) && e.length < 80)
    // prefere e-mails do próprio domínio
    .sort((a, b) => Number(b.endsWith("@" + siteDomain)) - Number(a.endsWith("@" + siteDomain)));

  const social = {} as Record<keyof typeof SOCIAL_PATTERNS, string>;
  (Object.keys(SOCIAL_PATTERNS) as (keyof typeof SOCIAL_PATTERNS)[]).forEach((k) => {
    const re = new RegExp(SOCIAL_PATTERNS[k].source, "gi");
    const m = decoded.match(re);
    social[k] = m ? normalizeUrl(m[0].replace(/\/$/, "")) : "";
  });

  let whatsapp = "";
  for (const m of decoded.matchAll(WA_RE)) {
    const p = formatPhoneBR(m[1], ddd);
    if (p) {
      whatsapp = p;
      break;
    }
  }

  const phones = [...new Set([...decoded.matchAll(TEL_RE)].map((m) => formatPhoneBR(m[1], ddd)).filter(Boolean))];

  let contactUrl = "";
  for (const m of decoded.matchAll(/href=["']([^"'#]*(?:contato|contact|fale-conosco|faleconosco)[^"'#]*)["']/gi)) {
    if (/^(mailto|tel|javascript):/i.test(m[1])) continue;
    try {
      const u = new URL(m[1], baseUrl);
      if (/^https?:$/.test(u.protocol) && domainOf(u.toString()) === siteDomain) {
        contactUrl = u.toString();
        break;
      }
    } catch {
      /* ignora */
    }
  }

  return { emails, ...social, whatsapp, phones, contactUrl };
}

async function fetchPage(url: string, deadline: Deadline): Promise<string> {
  if (!isSafeHost(url) || deadline.expired(3000)) return "";
  const res = await fetchWithTimeout(url, {
    timeoutMs: Math.min(6000, deadline.remaining() - 2000),
    headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9" },
  });
  if (!res.ok) return "";
  if (!isSafeHost(res.url || url)) return "";
  return readLimited(res);
}

function apply(lead: Lead, f: PageFindings): void {
  if (!lead.email && f.emails[0]) lead.email = f.emails[0];
  (["instagram", "facebook", "linkedin", "tiktok", "youtube"] as const).forEach((k) => {
    if (!lead[k] && f[k]) lead[k] = f[k];
  });
  if (!lead.whatsapp && f.whatsapp) lead.whatsapp = f.whatsapp;
  if (!lead.telefone && f.phones[0]) lead.telefone = f.phones[0];
}

async function enrichOne(lead: Lead, deadline: Deadline): Promise<Lead> {
  const ddd = lead.telefone ? lead.telefone.slice(2, 4) : "";
  if (lead.website) {
    const html = await fetchPage(lead.website, deadline).catch(() => "");
    if (html) {
      const f = extractFromHtml(html, lead.website, ddd);
      apply(lead, f);
      // segunda página (contato) só se ainda faltar e-mail e houver tempo
      if (!lead.email && f.contactUrl && !deadline.expired(10000)) {
        const html2 = await fetchPage(f.contactUrl, deadline).catch(() => "");
        if (html2) apply(lead, extractFromHtml(html2, f.contactUrl, ddd));
      }
    }
  }
  // celular sem WhatsApp explícito: o próprio número é o candidato
  if (!lead.whatsapp && isMobileBR(lead.telefone)) lead.whatsapp = lead.telefone;
  return lead;
}

export async function enrichLeads(
  leads: Lead[],
  deadline: Deadline,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const targets = leads.filter((l) => l.website);
  // sem site: só aplica a regra de celular
  leads.filter((l) => !l.website).forEach((l) => {
    if (!l.whatsapp && isMobileBR(l.telefone)) l.whatsapp = l.telefone;
  });
  await pool(targets, 12, (l) => enrichOne(l, deadline), deadline, onProgress);
  leads.forEach((l) => {
    if (!l.whatsapp && isMobileBR(l.telefone)) l.whatsapp = l.telefone;
  });
  return targets.length;
}
