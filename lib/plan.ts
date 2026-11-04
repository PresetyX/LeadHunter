/**
 * Catálogo de produtos do LeadHunter. É a única fonte de preços e limites: o checkout, a
 * validação do pagamento e as cotas leem daqui, então nada disso pode ser alterado pelo cliente.
 */

export type PlanId = "lifetime" | "basic" | "pro" | "business";
export type MonthlyPlanId = Exclude<PlanId, "lifetime">;
export type ProductId = "lifetime" | "credits_1000" | MonthlyPlanId;

export interface Product {
  id: ProductId;
  title: string;
  priceBRL: number;
  kind: "lifetime" | "credits" | "monthly";
}

/** Oferta de lançamento: vitalício por R$30 enquanto houver menos de 50 vendas. */
export const LAUNCH_SLOTS = 50;

export const LIFETIME = {
  priceBRL: 30,
  leadsIncluded: 1000,
  dailySearches: 10,
} as const;

export const CREDIT_PACK = {
  priceBRL: 15,
  leads: 1000,
} as const;

export interface MonthlyPlan {
  id: MonthlyPlanId;
  name: string;
  priceBRL: number;
  /** leads por ciclo de 30 dias; null = ilimitado (com fair use) */
  leadsPerMonth: number | null;
  /** trava de fair use aplicada mesmo no "ilimitado" (proteção de custo da API) */
  fairUseLeadsPerMonth: number;
  dailySearches: number;
  highlight?: boolean;
  features: string[];
}

export const MONTHLY_PLANS: MonthlyPlan[] = [
  {
    id: "basic",
    name: "Básico",
    priceBRL: 29.9,
    leadsPerMonth: 1000,
    fairUseLeadsPerMonth: 1000,
    dailySearches: 20,
    features: ["Até 1.000 leads por mês", "Enriquecimento pelos sites", "Exportação CSV e XLSX", "WhatsApp formatado (55DDDNÚMERO)"],
  },
  {
    id: "pro",
    name: "Pro",
    priceBRL: 59.9,
    leadsPerMonth: 4500,
    fairUseLeadsPerMonth: 4500,
    dailySearches: 40,
    highlight: true,
    features: ["Até 4.500 leads por mês", "Enriquecimento completo pelos sites", "Suporte priorizado", "Exportação CSV e XLSX"],
  },
  {
    id: "business",
    name: "Business",
    priceBRL: 149.9,
    leadsPerMonth: null,
    fairUseLeadsPerMonth: 30000,
    dailySearches: 100,
    features: ["Leads ilimitados*", "Tudo do Pro", "Busca contínua", "Exportações ilimitadas para agências e times"],
  },
];

export const MONTHLY_BY_ID = Object.fromEntries(MONTHLY_PLANS.map((p) => [p.id, p])) as Record<MonthlyPlanId, MonthlyPlan>;

export const PRODUCTS: Record<ProductId, Product> = {
  lifetime: { id: "lifetime", title: "LeadHunter — Vitalício de lançamento (1.000 leads)", priceBRL: LIFETIME.priceBRL, kind: "lifetime" },
  credits_1000: { id: "credits_1000", title: "LeadHunter — Pacote de Créditos Extra (+1.000 leads)", priceBRL: CREDIT_PACK.priceBRL, kind: "credits" },
  basic: { id: "basic", title: "LeadHunter Básico — 30 dias", priceBRL: 29.9, kind: "monthly" },
  pro: { id: "pro", title: "LeadHunter Pro — 30 dias", priceBRL: 59.9, kind: "monthly" },
  business: { id: "business", title: "LeadHunter Business — 30 dias", priceBRL: 149.9, kind: "monthly" },
};

export const isProductId = (v: unknown): v is ProductId => typeof v === "string" && Object.hasOwn(PRODUCTS, v);

export const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export function brl(v: number): string {
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

/** URL pública do app, usada nos retornos e no webhook do Mercado Pago. */
export function appBaseUrl(reqUrl?: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;
  if (reqUrl) return new URL(reqUrl).origin;
  return "http://localhost:3000";
}
