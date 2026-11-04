import { fold } from "./normalize.ts";

/**
 * Mapeia nichos comuns (em português) para tags do OpenStreetMap.
 * Cada filtro vira uma linha do Overpass: nwr["chave"="valor"](area.a);
 * Quando nenhuma regra casa, a busca cai para um filtro por nome (regex).
 */
interface NicheRule {
  match: RegExp;
  tags: [string, string][];
  nameHints?: string[];
}

const RULES: NicheRule[] = [
  { match: /estetic|beleza|depila|spa\b|sobrancelha|harmoniza/, tags: [["shop", "beauty"], ["beauty", "*"], ["amenity", "spa"], ["leisure", "spa"]], nameHints: ["estetica", "estética", "beauty", "spa", "harmoniza"] },
  { match: /imobili|corretor|imove/, tags: [["office", "estate_agent"], ["shop", "estate_agent"]], nameHints: ["imobili", "imóveis", "imoveis"] },
  { match: /dentist|odonto|dental/, tags: [["amenity", "dentist"], ["healthcare", "dentist"]], nameHints: ["odonto", "dental"] },
  { match: /clinica|medic|consultorio|saude/, tags: [["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "clinic"], ["healthcare", "doctor"]] },
  { match: /fisioter/, tags: [["healthcare", "physiotherapist"]], nameHints: ["fisio"] },
  { match: /psicolog/, tags: [["healthcare", "psychotherapist"]], nameHints: ["psicolog"] },
  { match: /veterin|pet ?shop|petshop|animal/, tags: [["amenity", "veterinary"], ["shop", "pet"], ["shop", "pet_grooming"]], nameHints: ["pet", "vet"] },
  { match: /academia|crossfit|fitness|pilates|musculac/, tags: [["leisure", "fitness_centre"], ["sport", "fitness"]], nameHints: ["academia", "fit", "pilates", "cross"] },
  { match: /restaurant|comida|gastronom/, tags: [["amenity", "restaurant"]] },
  { match: /pizzar/, tags: [["cuisine", "pizza"]], nameHints: ["pizza"] },
  { match: /hamburg|lanchonete|burger/, tags: [["cuisine", "burger"], ["amenity", "fast_food"]], nameHints: ["burger", "lanche"] },
  { match: /cafe|cafeteria/, tags: [["amenity", "cafe"]] },
  { match: /bar\b|bares|pub|choperia/, tags: [["amenity", "bar"], ["amenity", "pub"]] },
  { match: /padaria|panific/, tags: [["shop", "bakery"]], nameHints: ["padaria", "panific"] },
  { match: /mercad|supermerc/, tags: [["shop", "supermarket"], ["shop", "convenience"]] },
  { match: /farmac|drogar/, tags: [["amenity", "pharmacy"]] },
  { match: /salao|cabeleire|barbear|barber/, tags: [["shop", "hairdresser"]], nameHints: ["barbearia", "salão", "salao", "hair"] },
  { match: /advoga|juridic|direito/, tags: [["office", "lawyer"]], nameHints: ["advoca", "advoga"] },
  { match: /contab|contador/, tags: [["office", "accountant"]], nameHints: ["contab"] },
  { match: /oficina|mecanic|auto ?center|funilar/, tags: [["shop", "car_repair"], ["shop", "tyres"]], nameHints: ["auto", "mecânica", "mecanica"] },
  { match: /concession|carros|veiculo|automove/, tags: [["shop", "car"]] },
  { match: /hotel|pousada|hostel/, tags: [["tourism", "hotel"], ["tourism", "guest_house"], ["tourism", "hostel"]] },
  { match: /escola|colegio|curso|idioma|ingles/, tags: [["amenity", "school"], ["amenity", "language_school"], ["amenity", "college"]] },
  { match: /otica/, tags: [["shop", "optician"]] },
  { match: /floricult|flores/, tags: [["shop", "florist"]] },
  { match: /roupa|moda|boutique|vestuario/, tags: [["shop", "clothes"], ["shop", "boutique"]] },
  { match: /movei|decora|planejad/, tags: [["shop", "furniture"], ["shop", "interior_decoration"]] },
  { match: /material de constru|construcao|home center/, tags: [["shop", "hardware"], ["shop", "doityourself"]] },
  { match: /construtora|engenharia|arquitet/, tags: [["office", "construction_company"], ["office", "architect"], ["office", "engineer"]] },
  { match: /seguro|corretora de seg/, tags: [["office", "insurance"]] },
  { match: /tatuag|tattoo/, tags: [["shop", "tattoo"]] },
  { match: /lavanderia/, tags: [["shop", "laundry"], ["shop", "dry_cleaning"]] },
  { match: /grafica|impressao/, tags: [["shop", "copyshop"], ["craft", "printer"]] },
  { match: /agencia de viag|turismo/, tags: [["shop", "travel_agency"]] },
  { match: /marketing|publicidade|agencia digital/, tags: [["office", "advertising_agency"], ["office", "marketing"]] },
  { match: /software|ti\b|tecnologia|informatica/, tags: [["office", "it"], ["shop", "computer"]] },
];

export interface NicheQuery {
  tags: [string, string][];
  nameRegex: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
}

/** Remove plurais simples para o regex por nome: "clinicas esteticas" -> "clinica estetica" */
function singularize(word: string): string {
  if (word.length > 4 && word.endsWith("oes")) return word.slice(0, -3) + "ao";
  if (word.length > 4 && word.endsWith("ais")) return word.slice(0, -2) + "l";
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com", "a", "o"]);

export function buildNicheQuery(niche: string): NicheQuery {
  const f = fold(niche);
  const tags: [string, string][] = [];
  const hints = new Set<string>();

  for (const rule of RULES) {
    if (rule.match.test(f)) {
      rule.tags.forEach((t) => {
        if (!tags.some(([k, v]) => k === t[0] && v === t[1])) tags.push(t);
      });
      rule.nameHints?.forEach((h) => hints.add(fold(h)));
    }
  }

  const words = f
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(singularize);
  // Busca por nome sempre acompanha as tags: pega estabelecimentos sem a tag correta.
  const longest = [...words].sort((a, b) => b.length - a.length).slice(0, 2);
  longest.forEach((w) => hints.add(w.length > 6 ? w.slice(0, w.length - 1) : w));

  // regex do Overpass com case-insensitive; trata acentos com classes simples
  const accentize = (w: string) =>
    escapeRegex(w)
      .replace(/a/g, "[aáàâã]")
      .replace(/e/g, "[eéê]")
      .replace(/i/g, "[ií]")
      .replace(/o/g, "[oóôõ]")
      .replace(/u/g, "[uúü]")
      .replace(/c/g, "[cç]");

  const nameRegex = [...hints].filter(Boolean).map(accentize).join("|");
  return { tags, nameRegex };
}

/**
 * Sinônimos usados nas consultas ao Google: a mesma empresa costuma estar cadastrada como
 * "clínica odontológica" e não como "dentista". Sempre inclui o termo digitado, no máximo 3.
 */
const GOOGLE_SYNONYMS: [RegExp, string[]][] = [
  [/dentist|odonto|dental/, ["dentista", "clínica odontológica", "consultório odontológico"]],
  [/imobili|imove|corretor de imo/, ["imobiliária", "corretor de imóveis"]],
  [/estetic|harmoniza/, ["clínica de estética", "estética facial e corporal"]],
  [/advoga|advocacia|juridic/, ["advogado", "escritório de advocacia"]],
  [/contab|contador/, ["contabilidade", "escritório de contabilidade"]],
  [/psicolog/, ["psicólogo", "clínica de psicologia"]],
  [/fisioter/, ["fisioterapia", "clínica de fisioterapia"]],
  [/veterin/, ["veterinário", "clínica veterinária"]],
  [/pet ?shop|petshop/, ["pet shop", "banho e tosa"]],
  [/academia|musculac/, ["academia"]],
  [/barbear|barber/, ["barbearia"]],
  [/salao|cabeleire/, ["salão de beleza", "cabeleireiro"]],
  [/oficina|mecanic/, ["oficina mecânica", "auto center"]],
  [/restaurant/, ["restaurante"]],
  [/nutricion/, ["nutricionista"]],
  [/arquitet/, ["arquiteto", "escritório de arquitetura"]],
  [/construtora/, ["construtora"]],
  [/marketing|agencia digital/, ["agência de marketing", "agência de marketing digital"]],
];

export function googleQueryVariants(niche: string): string[] {
  const f = fold(niche);
  const out = [niche.trim()];
  for (const [re, syns] of GOOGLE_SYNONYMS) {
    if (re.test(f)) for (const s of syns) if (!out.some((o) => fold(o) === fold(s))) out.push(s);
  }
  return out.slice(0, 3);
}
