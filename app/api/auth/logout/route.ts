import { NextRequest, NextResponse } from "next/server";
import { clearedSessionCookie } from "@/lib/session";
import { getCurrentUserFull, sameOrigin } from "@/lib/auth";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sai, libera a conta para outro dispositivo e invalida todos os tokens antigos.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  try {
    const user = await getCurrentUserFull();
    if (user) {
      await store().updateUser(user.id, (u) => ({ sessionVersion: u.sessionVersion + 1, activeSession: null }));
    }
  } catch (e) {
    console.error("logout error", e);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearedSessionCookie());
  return res;
}
