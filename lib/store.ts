import { createHash, randomUUID } from "node:crypto";
import { get, put, del, list, BlobPreconditionFailedError } from "@vercel/blob";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Billing } from "./quota.ts";

// Persistência: Postgres (DATABASE_URL) ou Vercel Blob PRIVADO (BLOB_READ_WRITE_TOKEN).
// Blob: e-mail único via criação atômica (allowOverwrite:false) e atualizações com ETag (ifMatch).

export class ConfigError extends Error {}

/** A única sessão (dispositivo) autorizada a usar a conta neste momento. */
export interface ActiveSession {
  sid: string;
  ip: string;
  ua: string;
  createdAt: string;
  lastSeen: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  paid: boolean;
  paidAt: string | null;
  paymentId: string | null;
  sessionVersion: number;
  activeSession: ActiveSession | null;
  /** plano, saldo de leads e contadores de uso (ver lib/quota.ts) */
  billing: Billing | null;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  userId: string | null;
  status: string;
  statusDetail: string | null;
  amount: number;
  currency: string;
  method: string | null;
  updatedAt: string;
}

interface Store {
  createUser(email: string, name: string, passwordHash: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  /** patch recebe o estado ATUAL e devolve as mudanças (ou null para não gravar). Roda de novo em caso de conflito. */
  updateUser(id: string, patch: (u: User) => Partial<User> | null): Promise<User | null>;
  savePayment(p: PaymentRecord): Promise<void>;
  /** vendas do vitalício de lançamento (idempotente por pagamento) */
  recordSale(paymentId: string): Promise<void>;
  removeSale(paymentId: string): Promise<void>;
  countSales(): Promise<number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

const newUser = (email: string, name: string, passwordHash: string): User => ({
  id: randomUUID(),
  email,
  name,
  passwordHash,
  paid: false,
  paidAt: null,
  paymentId: null,
  sessionVersion: 1,
  activeSession: null,
  billing: null,
  createdAt: new Date().toISOString(),
});

const withDefaults = (u: User): User => ({ ...u, activeSession: u.activeSession ?? null, billing: u.billing ?? null });

/* ------------------------------------------------------------------ Blob */

const emailKey = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex");

async function blobRead<T>(path: string): Promise<{ data: T; etag: string } | null> {
  const res = await get(path, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200) return null;
  const data = (await new Response(res.stream).json()) as T;
  return { data, etag: res.blob.etag };
}

async function blobWrite(path: string, data: unknown, opts: { create?: boolean; ifMatch?: string } = {}) {
  return put(path, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: !opts.create,
    ...(opts.ifMatch ? { ifMatch: opts.ifMatch } : {}),
    cacheControlMaxAge: 60,
  });
}

const blobStore: Store = {
  async createUser(email, name, passwordHash) {
    const user = newUser(email, name, passwordHash);
    const emailPath = `users/email/${emailKey(email)}.json`;
    try {
      await blobWrite(emailPath, { id: user.id }, { create: true });
    } catch {
      const existing = await blobRead<{ id: string }>(emailPath);
      if (existing) return null;
      throw new Error("Falha ao reservar o e-mail.");
    }
    await blobWrite(`users/id/${user.id}.json`, user, { create: true });
    return user;
  },

  async getUser(id) {
    if (!isUuid(id)) return null;
    const r = await blobRead<User>(`users/id/${id}.json`);
    return r ? withDefaults(r.data) : null;
  },

  async findUserByEmail(email) {
    const ref = await blobRead<{ id: string }>(`users/email/${emailKey(email)}.json`);
    return ref ? blobStore.getUser(ref.data.id) : null;
  },

  async updateUser(id, patch) {
    if (!isUuid(id)) return null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await blobRead<User>(`users/id/${id}.json`);
      if (!cur) return null;
      const current = withDefaults(cur.data);
      const changes = patch(current);
      if (!changes) return current;
      const next: User = { ...current, ...changes, id: current.id, email: current.email, createdAt: current.createdAt };
      try {
        await blobWrite(`users/id/${id}.json`, next, { ifMatch: cur.etag });
        return next;
      } catch (e) {
        if (e instanceof BlobPreconditionFailedError) continue; // outro processo gravou antes: relê e reavalia
        throw e;
      }
    }
    throw new Error("Conflito ao atualizar usuário. Tente novamente.");
  },

  async savePayment(p) {
    await blobWrite(`payments/${p.id}.json`, p);
  },

  async recordSale(paymentId) {
    try {
      await blobWrite(`sales/lifetime/${saleKey(paymentId)}.json`, { paymentId, at: new Date().toISOString() }, { create: true });
    } catch (e) {
      if (!(await blobRead(`sales/lifetime/${saleKey(paymentId)}.json`))) throw e; // já existia = ok
    }
  },

  async removeSale(paymentId) {
    const { blobs } = await list({ prefix: `sales/lifetime/${saleKey(paymentId)}.json`, limit: 1 });
    if (blobs[0]) await del(blobs[0].url);
  },

  async countSales() {
    let total = 0;
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "sales/lifetime/", limit: 1000, cursor });
      total += page.blobs.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return total;
  },
};

const saleKey = (paymentId: string) => paymentId.replace(/[^a-zA-Z0-9_-]/g, "");

/* -------------------------------------------------------------- Postgres */

let pg: NeonQueryFunction<false, false> | null = null;
let pgReady: Promise<void> | null = null;

async function sql(): Promise<NeonQueryFunction<false, false>> {
  if (!pg) pg = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL)!);
  if (!pgReady) {
    const q = pg;
    pgReady = (async () => {
      await q`CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        paid BOOLEAN NOT NULL DEFAULT FALSE,
        paid_at TIMESTAMPTZ,
        payment_id TEXT,
        session_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await q`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session JSONB`;
      await q`ALTER TABLE users ADD COLUMN IF NOT EXISTS billing JSONB`;
      await q`CREATE TABLE IF NOT EXISTS lifetime_sales (payment_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
      await q`CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        user_id UUID,
        status TEXT NOT NULL,
        status_detail TEXT,
        amount NUMERIC(10, 2),
        currency TEXT,
        method TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    })().catch((e) => {
      pgReady = null;
      throw e;
    });
  }
  await pgReady;
  return pg;
}

type PgUser = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  paid: boolean;
  paid_at: string | Date | null;
  payment_id: string | null;
  session_version: number;
  active_session: ActiveSession | null;
  billing: Billing | null;
  created_at: string | Date;
};

const fromPg = (r: PgUser): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  passwordHash: r.password_hash,
  paid: r.paid,
  paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  paymentId: r.payment_id,
  sessionVersion: Number(r.session_version),
  activeSession: r.active_session ?? null,
  billing: r.billing ?? null,
  createdAt: new Date(r.created_at).toISOString(),
});

const pgStore: Store = {
  async createUser(email, name, passwordHash) {
    const q = await sql();
    const u = newUser(email, name, passwordHash);
    const rows = (await q`
      INSERT INTO users (id, email, name, password_hash) VALUES (${u.id}, ${email}, ${name}, ${passwordHash})
      ON CONFLICT (email) DO NOTHING RETURNING *`) as PgUser[];
    return rows[0] ? fromPg(rows[0]) : null;
  },
  async getUser(id) {
    if (!isUuid(id)) return null;
    const q = await sql();
    const rows = (await q`SELECT * FROM users WHERE id = ${id}`) as PgUser[];
    return rows[0] ? fromPg(rows[0]) : null;
  },
  async findUserByEmail(email) {
    const q = await sql();
    const rows = (await q`SELECT * FROM users WHERE email = ${email}`) as PgUser[];
    return rows[0] ? fromPg(rows[0]) : null;
  },
  async updateUser(id, patch) {
    if (!isUuid(id)) return null;
    const q = await sql();
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows = (await q`SELECT * FROM users WHERE id = ${id}`) as PgUser[];
      if (!rows[0]) return null;
      const cur = fromPg(rows[0]);
      const changes = patch(cur);
      if (!changes) return cur;
      const n = { ...cur, ...changes };
      const curSess = cur.activeSession ? JSON.stringify(cur.activeSession) : null;
      const nextSess = n.activeSession ? JSON.stringify(n.activeSession) : null;
      const curBill = cur.billing ? JSON.stringify(cur.billing) : null;
      const nextBill = n.billing ? JSON.stringify(n.billing) : null;
      // otimista: só grava se nada relevante mudou desde a leitura
      const updated = (await q`
        UPDATE users SET name = ${n.name}, password_hash = ${n.passwordHash}, paid = ${n.paid}, paid_at = ${n.paidAt},
          payment_id = ${n.paymentId}, session_version = ${n.sessionVersion}, active_session = ${nextSess}::jsonb,
          billing = ${nextBill}::jsonb
        WHERE id = ${id} AND session_version = ${cur.sessionVersion} AND paid = ${cur.paid}
          AND active_session IS NOT DISTINCT FROM ${curSess}::jsonb AND billing IS NOT DISTINCT FROM ${curBill}::jsonb
        RETURNING *`) as PgUser[];
      if (updated[0]) return fromPg(updated[0]);
    }
    throw new Error("Conflito ao atualizar usuário. Tente novamente.");
  },
  async savePayment(p) {
    const q = await sql();
    await q`
      INSERT INTO payments (id, user_id, status, status_detail, amount, currency, method, updated_at)
      VALUES (${p.id}, ${p.userId}, ${p.status}, ${p.statusDetail}, ${p.amount}, ${p.currency}, ${p.method}, NOW())
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, status_detail = EXCLUDED.status_detail, updated_at = NOW()`;
  },
  async recordSale(paymentId) {
    const q = await sql();
    await q`INSERT INTO lifetime_sales (payment_id) VALUES (${paymentId}) ON CONFLICT DO NOTHING`;
  },
  async removeSale(paymentId) {
    const q = await sql();
    await q`DELETE FROM lifetime_sales WHERE payment_id = ${paymentId}`;
  },
  async countSales() {
    const q = await sql();
    const rows = (await q`SELECT COUNT(*)::int AS n FROM lifetime_sales`) as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  },
};

/* ------------------------------------------- Memória (somente testes locais) */

const mem = { users: new Map<string, User>(), emails: new Map<string, string>(), sales: new Set<string>() };
const memoryStore: Store = {
  async createUser(email, name, passwordHash) {
    if (mem.emails.has(email)) return null;
    const user = newUser(email, name, passwordHash);
    mem.emails.set(email, user.id);
    mem.users.set(user.id, user);
    return structuredClone(user);
  },
  async getUser(id) {
    const u = mem.users.get(id);
    return u ? structuredClone(u) : null;
  },
  async findUserByEmail(email) {
    const id = mem.emails.get(email);
    return id ? memoryStore.getUser(id) : null;
  },
  async updateUser(id, patch) {
    const u = mem.users.get(id);
    if (!u) return null;
    const changes = patch(structuredClone(u));
    if (changes) mem.users.set(id, { ...u, ...changes, id: u.id, email: u.email });
    return structuredClone(mem.users.get(id)!);
  },
  async savePayment() {},
  async recordSale(paymentId) {
    mem.sales.add(paymentId);
  },
  async removeSale(paymentId) {
    mem.sales.delete(paymentId);
  },
  async countSales() {
    return mem.sales.size;
  },
};

export function store(): Store {
  // backend em memória só existe fora da Vercel e com flag explícita de teste
  if (process.env.LEADHUNTER_TEST_MEMORY_STORE === "1" && !process.env.VERCEL) return memoryStore;
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return pgStore;
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore;
  throw new ConfigError("Armazenamento não configurado.");
}
