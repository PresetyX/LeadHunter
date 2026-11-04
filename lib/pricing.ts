import { store } from "./store";
import { LAUNCH_SLOTS } from "./plan";

export type PricingMode = "launch" | "monthly";

export interface PricingState {
  mode: PricingMode;
  sales: number;
  slotsLeft: number;
  /** mostra o seletor de pré-visualização (somente desenvolvimento ou flag explícita) */
  devToggle: boolean;
}

let cached: { at: number; sales: number } | null = null;

/** Vendas do vitalício de lançamento. Cache de 30s por instância para não ler o banco a cada página. */
export async function lifetimeSales(fresh = false): Promise<number> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.sales;
  const sales = await store().countSales();
  cached = { at: Date.now(), sales };
  return sales;
}

/**
 * ENQUANTO vendas < 50: vitalício de R$30 em destaque. A PARTIR de 50: planos mensais.
 * PRICING_MODE=launch|monthly força um modo (para o dono do produto), e vale também no servidor.
 */
export async function pricingState(fresh = false): Promise<PricingState> {
  const forced = process.env.PRICING_MODE?.trim();
  let sales = 0;
  try {
    sales = await lifetimeSales(fresh);
  } catch (e) {
    console.error("sales count error", e);
    // sem conseguir contar, não vende vitalício "às cegas" acima do limite
    sales = LAUNCH_SLOTS;
  }
  const auto: PricingMode = sales < LAUNCH_SLOTS ? "launch" : "monthly";
  const mode: PricingMode = forced === "launch" || forced === "monthly" ? forced : auto;
  return {
    mode,
    sales,
    slotsLeft: Math.max(0, LAUNCH_SLOTS - sales),
    devToggle: process.env.NODE_ENV === "development" || process.env.PRICING_DEV_TOGGLE === "1",
  };
}

/**
 * Quem pode ver o dev-toggle em produção: e-mails em ADMIN_EMAILS (separados por vírgula).
 * É só pré-visualização visual — o que pode ser comprado continua decidido no servidor.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
