import { get, put } from "@vercel/blob";

/**
 * Trava global de chamadas à Google Places API.
 *
 * A busca com telefone e site cai no SKU "Enterprise" da Google: 1.000 chamadas grátis por mês e
 * depois US$ 35 a cada 1.000. Este contador (somando todos os usuários) bloqueia novas chamadas ao
 * Google quando o teto do mês é atingido — a busca então cai para o OpenStreetMap em vez de gerar custo.
 * Teto configurável em PLACES_MONTHLY_CALL_CAP (padrão 900, com folga sobre a cota grátis).
 */
export const DEFAULT_MONTHLY_CAP = 900;

export function monthlyCap(raw = process.env.PLACES_MONTHLY_CALL_CAP): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MONTHLY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MONTHLY_CAP;
}

/** Mês de referência (UTC) — a cota gratuita do Google zera mensalmente. */
export function monthKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

export interface CounterStore {
  read(month: string): Promise<number>;
  write(month: string, used: number): Promise<void>;
}

/** Contador com exclusão mútua dentro da instância; entre instâncias o teto tem folga para pequenas corridas. */
export function createBudget(storage: CounterStore, cap: number, clock: () => number = Date.now) {
  let month = "";
  let used = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    /** Reserva uma chamada ao Google. Falso = teto mensal atingido (ou contador indisponível). */
    takeCall: () =>
      run(async () => {
        const m = monthKey(clock());
        // sempre relê o valor persistido: outras instâncias também consomem a cota
        const local = month === m ? used : 0;
        // se o contador não puder ser lido, só vale o que esta instância já contou (nunca libera além do teto)
        const stored = await storage.read(m).catch(() => local);
        month = m;
        used = Math.max(local, stored);
        if (used >= cap) return false;
        used++;
        await storage.write(m, used).catch((e) => console.error("places budget write error", e));
        return true;
      }),
    peek: () => ({ month, used, cap }),
  };
}

const blobPath = (m: string) => `budget/places-${m}.json`;

const blobStore: CounterStore = {
  async read(m) {
    const res = await get(blobPath(m), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return 0;
    const j = (await new Response(res.stream).json()) as { used?: number };
    return Number(j.used) || 0;
  },
  async write(m, used) {
    await put(blobPath(m), JSON.stringify({ used }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
  },
};

/** Armazenamento em memória (sem Blob configurado — desenvolvimento local). */
function memoryStore(): CounterStore {
  const m = new Map<string, number>();
  return { read: async (k) => m.get(k) ?? 0, write: async (k, v) => void m.set(k, v) };
}

let shared: ReturnType<typeof createBudget> | null = null;

/** Reserva uma chamada ao Google contra o teto mensal global. */
export function takePlacesCall(): Promise<boolean> {
  shared ??= createBudget(process.env.BLOB_READ_WRITE_TOKEN ? blobStore : memoryStore(), monthlyCap());
  return shared.takeCall();
}
