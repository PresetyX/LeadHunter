import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { store, ConfigError, type ActiveSession, type User } from "./store";
import { SESSION_COOKIE, verifySession } from "./session";
import { hasAccess, normalizeBilling, usageOf, type Usage } from "./quota";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  paid: boolean;
  usage: Usage;
}

/** "paid" = tem um plano que ainda vale (vitalício, créditos ou mensal ativo). Sempre calculado no servidor. */
export const toPublic = (u: User): PublicUser => {
  const now = Date.now();
  const billing = normalizeBilling(u.billing, u.paid);
  return { id: u.id, email: u.email, name: u.name, paid: hasAccess(billing, now), usage: usageOf(billing, now) };
};

/**
 * Uma conta = um dispositivo ativo por vez.
 * A sessão do dispositivo fica "viva" enquanto for usada; depois de SESSION_IDLE_MS sem
 * nenhuma requisição ela expira e libera a conta (evita trancar quem perdeu o aparelho).
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export function isLeaseActive(s: ActiveSession | null | undefined, now = Date.now()): s is ActiveSession {
  return !!s && now - Date.parse(s.lastSeen) < SESSION_IDLE_MS;
}

export function maskIp(ip: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").slice(0, 2).join(".") + ".*.*";
  if (ip.includes(":")) return ip.split(":").slice(0, 2).join(":") + ":…";
  return "desconhecido";
}

/** IPv4: mesmo endereço. IPv6: mesmo prefixo /64 (o sistema troca o sufixo sozinho por privacidade). */
export function sameNetwork(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(":") && b.includes(":")) {
    const p = (ip: string) => ip.toLowerCase().split(":").slice(0, 4).join(":");
    return p(a) === p(b);
  }
  return false;
}

export function clientIpFromHeaders(h: Headers): string {
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim().slice(0, 64) || "desconhecido";
}

export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}

/**
 * Usuário logado. Exige: token assinado válido, versão da sessão igual à do banco e que ESTE
 * dispositivo (sid) seja a sessão ativa da conta. O status de pagamento sempre vem do banco.
 */
export async function getCurrentUserFull(): Promise<User | null> {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return null;
  const db = store();
  const user = await db.getUser(session.uid);
  if (!user || user.sessionVersion !== session.sv || user.email !== session.email) return null;

  const active = user.activeSession;
  if (!active || active.sid !== session.sid || !isLeaseActive(active)) return null;

  // a sessão fica presa ao IP onde o login foi feito: mudou de rede, precisa entrar de novo
  const ip = clientIpFromHeaders(await headers());
  if (!sameNetwork(ip, active.ip)) return null;

  // mantém a sessão viva (no máximo uma gravação por minuto)
  if (Date.now() - Date.parse(active.lastSeen) > TOUCH_EVERY_MS) {
    await db
      .updateUser(user.id, (u) =>
        u.activeSession?.sid === session.sid ? { activeSession: { ...u.activeSession, lastSeen: new Date().toISOString() } } : null,
      )
      .catch((e) => console.error("session touch error", e));
  }
  return user;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const u = await getCurrentUserFull();
  return u ? toPublic(u) : null;
}

export type ClaimResult = { ok: true; user: User; sid: string } | { ok: false; active: ActiveSession };

/**
 * Tenta tornar ESTE dispositivo a sessão ativa da conta. Falha se outro dispositivo estiver
 * ativo. Atômico: roda dentro do updateUser com controle de concorrência (dois logins ao mesmo
 * tempo não conseguem os dois vencer).
 */
export async function claimSession(userId: string, ip: string, ua: string, currentSid?: string): Promise<ClaimResult> {
  const sid = randomUUID();
  const now = new Date().toISOString();
  const updated = await store().updateUser(userId, (u) => {
    const a = u.activeSession;
    if (isLeaseActive(a) && a.sid !== currentSid) return null; // outro dispositivo em uso
    return { activeSession: { sid, ip, ua: ua.slice(0, 160), createdAt: now, lastSeen: now } };
  });
  if (!updated) throw new Error("Conta não encontrada.");
  if (updated.activeSession?.sid === sid) return { ok: true, user: updated, sid };
  return { ok: false, active: updated.activeSession! };
}

/** Guarda para as APIs pagas: 403 origem externa, 401 sem login, 402 sem pagamento, 503 sem configuração. */
export async function requirePaidUser(req?: Request): Promise<{ user: PublicUser; full: User } | { response: Response }> {
  if (req && !sameOrigin(req)) return { response: Response.json({ error: "Origem não permitida." }, { status: 403 }) };
  let full: User | null;
  let user: PublicUser | null;
  try {
    full = await getCurrentUserFull();
    user = full ? toPublic(full) : null;
  } catch (e) {
    console.error("auth error", e);
    const msg = e instanceof ConfigError ? e.message : "Serviço indisponível.";
    return { response: Response.json({ error: msg }, { status: 503 }) };
  }
  if (!user || !full) return { response: Response.json({ error: "Sua sessão terminou. Entre novamente." }, { status: 401 }) };
  if (!user.paid) {
    return { response: Response.json({ error: "Seu acesso ainda não foi liberado. Conclua o pagamento.", code: "NO_PLAN" }, { status: 402 }) };
  }
  return { user, full };
}

/** Proteção CSRF: exige Origin (ou Referer) do próprio site em requisições que alteram estado. */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const origin = req.headers.get("origin") || req.headers.get("referer");
  if (!host || !origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Limitador simples por chave (melhor esforço — cada instância serverless tem o seu). */
const hits = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}
