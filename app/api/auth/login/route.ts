import { NextRequest, NextResponse } from "next/server";
import { store, ConfigError } from "@/lib/store";
import { hashPassword, verifyPassword } from "@/lib/password";
import { signSession, sessionCookie, verifySession, SESSION_COOKIE } from "@/lib/session";
import { claimSession, clientIp, maskIp, rateLimit, sameOrigin, SESSION_IDLE_MS } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 160);
  const password = String(body.password ?? "").slice(0, 200);
  const ip = clientIp(req);

  if (!rateLimit("login:" + ip, 20, 15 * 60 * 1000) || !rateLimit("login-email:" + email, 8, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }

  try {
    const user = email ? await store().findUserByEmail(email) : null;
    // mesmo custo de CPU quando o e-mail não existe — não revela quais e-mails têm conta
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
    if (!user || !ok) return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });

    // se ESTE navegador já é o dispositivo ativo (ex.: reabriu a página de login), reaproveita
    const current = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    const currentSid = current && current.uid === user.id ? current.sid : undefined;

    const claim = await claimSession(user.id, ip, req.headers.get("user-agent") || "", currentSid);
    if (!claim.ok) {
      const mins = Math.max(1, Math.round((Date.now() - Date.parse(claim.active.lastSeen)) / 60000));
      const freeIn = Math.max(1, Math.ceil((SESSION_IDLE_MS - (Date.now() - Date.parse(claim.active.lastSeen))) / 60000));
      return NextResponse.json(
        {
          error:
            `Esta conta já está conectada em outro dispositivo (IP ${maskIp(claim.active.ip)}, ativo há ${mins} min). ` +
            `Clique em "Sair" nesse dispositivo para usar aqui. Sem acesso a ele? A sessão é liberada sozinha em ${freeIn} min sem uso.`,
          code: "SESSION_IN_USE",
        },
        { status: 409 },
      );
    }

    const token = await signSession({ uid: user.id, email: user.email, sv: claim.user.sessionVersion, sid: claim.sid });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(token));
    return res;
  } catch (e) {
    console.error("login error", e);
    const status = e instanceof ConfigError ? 503 : 500;
    return NextResponse.json({ error: e instanceof ConfigError ? e.message : "Não foi possível entrar." }, { status });
  }
}
