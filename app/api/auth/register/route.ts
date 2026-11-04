import { NextRequest, NextResponse } from "next/server";
import { store, ConfigError } from "@/lib/store";
import { hashPassword } from "@/lib/password";
import { signSession, sessionCookie } from "@/lib/session";
import { claimSession, clientIp, rateLimit, sameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  const ip = clientIp(req);
  if (!rateLimit("register:" + ip, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente mais tarde." }, { status: 429 });
  }
  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const name = String(body.name ?? "").replace(/[<>]/g, "").trim().slice(0, 80);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (name.length < 2) return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });
  if (email.length > 160 || !EMAIL_RE.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (password.length < 8 || password.length > 200) {
    return NextResponse.json({ error: "A senha precisa ter entre 8 e 200 caracteres." }, { status: 400 });
  }

  try {
    const user = await store().createUser(email, name, await hashPassword(password));
    if (!user) return NextResponse.json({ error: "Já existe uma conta com esse e-mail. Faça login." }, { status: 409 });
    const claim = await claimSession(user.id, ip, req.headers.get("user-agent") || "");
    if (!claim.ok) return NextResponse.json({ error: "Conta criada. Faça login para continuar." }, { status: 409 });
    const token = await signSession({ uid: user.id, email: user.email, sv: claim.user.sessionVersion, sid: claim.sid });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(token));
    return res;
  } catch (e) {
    console.error("register error", e);
    const status = e instanceof ConfigError ? 503 : 500;
    return NextResponse.json({ error: e instanceof ConfigError ? e.message : "Não foi possível criar a conta." }, { status });
  }
}
