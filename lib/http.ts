export const USER_AGENT = "LeadHunterBot/1.0 (lead enrichment for local businesses)";

export class Deadline {
  private end: number;
  private stopped = false;
  constructor(ms: number) {
    this.end = Date.now() + ms;
  }
  remaining(): number {
    return Math.max(0, this.end - Date.now());
  }
  expired(reserveMs = 0): boolean {
    return this.remaining() <= reserveMs;
  }
  /** Cancelamento pedido pelo usuário: zera o prazo, então todos os laços que checam o deadline encerram. */
  cancel(): void {
    this.stopped = true;
    this.end = 0;
  }
  get cancelled(): boolean {
    return this.stopped;
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 8000, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      headers: { "User-Agent": USER_AGENT, ...(headers || {}) },
      signal: controller.signal,
      redirect: rest.redirect ?? "follow",
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  deadline?: Deadline,
  onDone?: (done: number, total: number) => void,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < items.length) {
      if (deadline?.expired(1500)) return;
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch {
        results[i] = undefined;
      }
      done++;
      onDone?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
