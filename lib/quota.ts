import { CREDIT_PACK, LIFETIME, MONTHLY_BY_ID, PERIOD_MS, PRODUCTS, type MonthlyPlanId, type ProductId } from "./plan.ts";

/**
 * Regras de plano e cota — funções puras (sem I/O), usadas pelo servidor dentro de
 * store.updateUser (atômico). Nunca confie em nada disso vindo do navegador.
 */

export interface Billing {
  /** comprou o vitalício de lançamento */
  lifetime: boolean;
  /** leads disponíveis no saldo vitalício (1.000 do vitalício + pacotes) */
  lifetimeAllowance: number;
  lifetimeUsed: number;
  /** plano mensal pré-pago ativo até planUntil */
  monthly: MonthlyPlanId | null;
  planUntil: string | null;
  periodStart: string | null;
  periodUsed: number;
  /** buscas do dia (fuso de Brasília) */
  dayKey: string;
  daySearches: number;
  /** pagamentos já aplicados (idempotência) */
  granted: string[];
  /** buscas recentes: repetir a mesma busca em 7 dias não consome cota */
  recent: Record<string, number>;
}

export const RERUN_FREE_MS = 7 * 24 * 60 * 60 * 1000;

export function emptyBilling(): Billing {
  return {
    lifetime: false,
    lifetimeAllowance: 0,
    lifetimeUsed: 0,
    monthly: null,
    planUntil: null,
    periodStart: null,
    periodUsed: 0,
    dayKey: "",
    daySearches: 0,
    granted: [],
    recent: {},
  };
}

/** Usuários antigos (pagaram antes dos planos) viram vitalício com 1.000 leads. */
export function normalizeBilling(b: Partial<Billing> | null | undefined, legacyPaid: boolean): Billing {
  const base = { ...emptyBilling(), ...(b || {}) };
  if (!b && legacyPaid) {
    base.lifetime = true;
    base.lifetimeAllowance = LIFETIME.leadsIncluded;
  }
  return base;
}

/** Data no fuso de Brasília (UTC-3, sem horário de verão desde 2019). */
export function dayKeyOf(now: number): string {
  return new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function monthlyActive(b: Billing, now: number): boolean {
  return !!b.monthly && !!b.planUntil && Date.parse(b.planUntil) > now;
}

/** Pode entrar no painel de busca (pagou algo que ainda vale). */
export function hasAccess(b: Billing, now: number): boolean {
  return b.lifetime || monthlyActive(b, now) || b.lifetimeAllowance > 0;
}

/** Ciclo mensal corrente (30 dias a partir da compra; reinicia sozinho enquanto o plano vale). */
function currentPeriod(b: Billing, now: number): { start: number; used: number } {
  if (!b.periodStart) return { start: now, used: 0 };
  let start = Date.parse(b.periodStart);
  let used = b.periodUsed;
  if (now - start >= PERIOD_MS) {
    start += Math.floor((now - start) / PERIOD_MS) * PERIOD_MS;
    used = 0;
  }
  return { start, used };
}

export interface Usage {
  mode: "monthly" | "lifetime" | "none";
  plan: MonthlyPlanId | "lifetime" | null;
  leadsLimit: number;
  leadsUsed: number;
  leadsRemaining: number;
  unlimited: boolean;
  searchesToday: number;
  searchesLimit: number;
  planUntil: string | null;
  /** saldo vitalício (pacotes) — mostrado também para quem tem plano mensal */
  lifetimeRemaining: number;
  /** já comprou o vitalício de lançamento */
  hasLifetime: boolean;
}

export function usageOf(b: Billing, now: number): Usage {
  const lifetimeRemaining = Math.max(0, b.lifetimeAllowance - b.lifetimeUsed);
  const today = dayKeyOf(now);
  const searchesToday = b.dayKey === today ? b.daySearches : 0;

  if (monthlyActive(b, now)) {
    const plan = MONTHLY_BY_ID[b.monthly!];
    const { used } = currentPeriod(b, now);
    const limit = plan.fairUseLeadsPerMonth;
    return {
      mode: "monthly",
      plan: plan.id,
      leadsLimit: limit,
      leadsUsed: used,
      leadsRemaining: Math.max(0, limit - used) + lifetimeRemaining,
      unlimited: plan.leadsPerMonth === null,
      searchesToday,
      searchesLimit: plan.dailySearches,
      planUntil: b.planUntil,
      lifetimeRemaining,
      hasLifetime: b.lifetime,
    };
  }
  if (b.lifetime || b.lifetimeAllowance > 0) {
    return {
      mode: "lifetime",
      plan: "lifetime",
      leadsLimit: b.lifetimeAllowance,
      leadsUsed: b.lifetimeUsed,
      leadsRemaining: lifetimeRemaining,
      unlimited: false,
      searchesToday,
      searchesLimit: LIFETIME.dailySearches,
      planUntil: null,
      lifetimeRemaining,
      hasLifetime: b.lifetime,
    };
  }
  return {
    mode: "none",
    plan: null,
    leadsLimit: 0,
    leadsUsed: 0,
    leadsRemaining: 0,
    unlimited: false,
    searchesToday,
    searchesLimit: 0,
    planUntil: null,
    lifetimeRemaining: 0,
    hasLifetime: false,
  };
}

export type BlockReason = "NO_PLAN" | "QUOTA_EXCEEDED" | "DAILY_LIMIT";

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  NO_PLAN: "Seu acesso ainda não foi liberado. Conclua o pagamento.",
  QUOTA_EXCEEDED: "Você usou todos os leads do seu plano. Adicione um pacote de créditos ou mude para um plano mensal.",
  DAILY_LIMIT: "Você atingiu o limite de buscas de hoje. O contador zera à meia-noite (horário de Brasília).",
};

/**
 * Reserva uma busca: confere plano, saldo e limite diário e já conta a busca do dia
 * (atômico, então duas abas não passam juntas do limite). Busca repetida em 7 dias é grátis.
 */
export function reserveSearch(
  b: Billing,
  key: string,
  now: number,
): { ok: true; patch: Billing; maxLeads: number; free: boolean } | { ok: false; reason: BlockReason } {
  const u = usageOf(b, now);
  if (u.mode === "none") return { ok: false, reason: "NO_PLAN" };
  const free = !!b.recent[key] && now - b.recent[key] < RERUN_FREE_MS;
  if (free) return { ok: true, patch: b, maxLeads: Number.MAX_SAFE_INTEGER, free: true };
  if (u.leadsRemaining <= 0) return { ok: false, reason: "QUOTA_EXCEEDED" };
  if (u.searchesToday >= u.searchesLimit) return { ok: false, reason: "DAILY_LIMIT" };
  const today = dayKeyOf(now);
  return {
    ok: true,
    free: false,
    maxLeads: u.leadsRemaining,
    patch: { ...b, dayKey: today, daySearches: u.searchesToday + 1 },
  };
}

/** Devolve a busca do dia quando ela falhou sem entregar nada. */
export function releaseSearch(b: Billing, now: number): Billing {
  if (b.dayKey !== dayKeyOf(now) || b.daySearches <= 0) return b;
  return { ...b, daySearches: b.daySearches - 1 };
}

/** Debita os leads entregues: primeiro do ciclo mensal, depois do saldo vitalício. */
export function consumeLeads(b: Billing, count: number, key: string, now: number): Billing {
  const recent = Object.fromEntries(
    Object.entries({ ...b.recent, [key]: now })
      .filter(([, t]) => now - t < RERUN_FREE_MS)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 60),
  );
  let left = Math.max(0, Math.floor(count));
  const next: Billing = { ...b, recent };
  if (monthlyActive(b, now)) {
    const plan = MONTHLY_BY_ID[b.monthly!];
    const { start, used } = currentPeriod(b, now);
    const take = Math.min(left, Math.max(0, plan.fairUseLeadsPerMonth - used));
    next.periodStart = new Date(start).toISOString();
    next.periodUsed = used + take;
    left -= take;
  }
  if (left > 0) next.lifetimeUsed = Math.min(b.lifetimeAllowance, b.lifetimeUsed + left);
  return next;
}

/** Aplica uma compra aprovada. Idempotente por paymentId. */
export function applyPurchase(b: Billing, product: ProductId, paymentId: string, now: number): Billing {
  if (b.granted.includes(paymentId)) return b;
  const next: Billing = { ...b, granted: [...b.granted, paymentId].slice(-100) };
  const kind = PRODUCTS[product].kind;
  if (kind === "lifetime") {
    next.lifetimeAllowance += next.lifetime ? 0 : LIFETIME.leadsIncluded;
    next.lifetime = true;
  } else if (kind === "credits") {
    next.lifetimeAllowance += CREDIT_PACK.leads;
  } else {
    const plan = product as MonthlyPlanId;
    const sameActive = monthlyActive(b, now) && b.monthly === plan;
    const base = sameActive ? Date.parse(b.planUntil!) : now;
    next.monthly = plan;
    next.planUntil = new Date(base + PERIOD_MS).toISOString();
    if (!sameActive) {
      // troca de plano ou nova assinatura: ciclo novo, começa do zero
      next.periodStart = new Date(now).toISOString();
      next.periodUsed = 0;
    }
  }
  return next;
}

/** Estorno/chargeback: desfaz o que AQUELE pagamento concedeu. */
export function revokePurchase(b: Billing, product: ProductId, paymentId: string, now: number): Billing {
  if (!b.granted.includes(paymentId)) return b;
  const next: Billing = { ...b, granted: b.granted.filter((g) => g !== paymentId) };
  const kind = PRODUCTS[product].kind;
  if (kind === "lifetime") {
    next.lifetime = false;
    next.lifetimeAllowance = Math.max(0, next.lifetimeAllowance - LIFETIME.leadsIncluded);
  } else if (kind === "credits") {
    next.lifetimeAllowance = Math.max(0, next.lifetimeAllowance - CREDIT_PACK.leads);
  } else if (b.monthly === product && b.planUntil) {
    const until = Date.parse(b.planUntil) - PERIOD_MS;
    next.planUntil = new Date(until).toISOString();
    if (until <= now) next.monthly = null;
  }
  return next;
}
