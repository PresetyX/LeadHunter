export type LeadSource = "outscraper" | "google_places" | "openstreetmap";

export interface Lead {
  id: string;
  nome: string;
  categoria: string;
  endereco: string;
  cidade: string;
  telefone: string; // formato 55DDDNUMERO (somente dígitos)
  whatsapp: string; // número provável de WhatsApp (celular) ou link wa.me encontrado no site
  website: string;
  avaliacao: number | null;
  totalAvaliacoes: number | null;
  email: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  tiktok: string;
  youtube: string;
  latitude: number | null;
  longitude: number | null;
  fonte: LeadSource;
}

export type StreamEvent =
  | { type: "status"; message: string; progress: number }
  | { type: "partial"; leads: Lead[] }
  | { type: "result"; leads: Lead[]; source: LeadSource; elapsedMs: number; enriched: number; usage?: import("./quota.ts").Usage; free?: boolean }
  | { type: "error"; message: string };

export const EXPORT_COLUMNS: { key: keyof Lead; label: string }[] = [
  { key: "nome", label: "Nome" },
  { key: "categoria", label: "Categoria" },
  { key: "endereco", label: "Endereço" },
  { key: "cidade", label: "Cidade" },
  { key: "telefone", label: "Telefone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "website", label: "Website" },
  { key: "avaliacao", label: "Avaliação" },
  { key: "totalAvaliacoes", label: "Nº Avaliações" },
  { key: "email", label: "E-mail" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "fonte", label: "Fonte" },
];
