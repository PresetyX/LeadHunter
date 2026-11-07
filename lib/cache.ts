import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

/**
 * Cache de resultados de busca (Blob privado). Evita pagar de novo ao Google pela mesma
 * busca e deixa buscas repetidas instantâneas. Falhas de cache nunca derrubam a busca.
 */
const pathOf = (key: string) => `cache/${createHash("sha256").update(key).digest("hex")}.json`;

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const res = await get(pathOf(key), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const hit = (await new Response(res.stream).json()) as { at: number; data: T };
    return Date.now() - hit.at > maxAgeMs ? null : hit.data;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, data: unknown): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(pathOf(key), JSON.stringify({ at: Date.now(), data }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
  } catch (e) {
    console.error("cache write error", e);
  }
}
