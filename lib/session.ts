import { SignJWT, jwtVerify } from "jose";

/** Funções de sessão compatíveis com Edge (usadas também pelo middleware). */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-lh_session" : "lh_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias
const ISSUER = "leadhunter";
const AUDIENCE = "leadhunter-web";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente ou curto demais (mínimo 32 caracteres).");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  uid: string;
  email: string;
  /** Versão da sessão: muda no logout e invalida todos os tokens antigos daquele usuário. */
  sv: number;
  /** Id do dispositivo: só o dispositivo com a sessão ativa no banco é aceito. */
  sid: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, sv: payload.sv, sid: payload.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.uid)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.sv !== "number" || typeof payload.sid !== "string") {
      return null;
    }
    return { uid: payload.sub, email: payload.email, sv: payload.sv, sid: payload.sid };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie(""), maxAge: 0 };
}
