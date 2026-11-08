import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ user: null }, { status: 503 });
  }
}
