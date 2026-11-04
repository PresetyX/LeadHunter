"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  AtSign,
  Building2,
  CircleCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Globe,
  LoaderCircle,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Sparkles,
  Square,
  Star,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Lead, LeadSource, StreamEvent } from "@/lib/types";
import { leadsToCsv } from "@/lib/csv";
import type { Usage } from "@/lib/quota";
import { UpgradePanel, UsageMeter } from "./UsagePanel";

const SOURCE_LABEL: Record<LeadSource, string> = {
  outscraper: "Google Maps (Outscraper)",
  google_places: "Google Places API",
  openstreetmap: "OpenStreetMap",
};

type SortKey = "nome" | "avaliacao" | "categoria" | "completude";
type Filter = "todos" | "telefone" | "whatsapp" | "email" | "website";

const EXAMPLES = [
  ["Clínicas Estéticas", "Indaiatuba, SP"],
  ["Imobiliárias", "Campinas, SP"],
  ["Dentistas", "Jundiaí, SP"],
  ["Academias", "Valinhos, SP"],
];

function completeness(l: Lead): number {
  return [l.telefone, l.whatsapp, l.website, l.email, l.instagram || l.facebook, l.endereco, l.avaliacao != null ? "x" : ""].filter(Boolean)
    .length;
}

function prettyPhone(p: string): string {
  const m = p.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}

function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

function handle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    return path.length ? "@" + path[path.length - 1].replace(/^@/, "") : u.hostname;
  } catch {
    return url;
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function LeadDashboard({ initialUsage }: { initialUsage: Usage }) {
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [limit, setLimit] = useState(60);
  const [enrich, setEnrich] = useState(true);

  const [loading, setLoading] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [meta, setMeta] = useState<{ source: LeadSource; elapsedMs: number; enriched: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [usage, setUsage] = useState<Usage>(initialUsage);
  const initialBlock =
    !initialUsage.unlimited && initialUsage.leadsRemaining <= 0
      ? "QUOTA_EXCEEDED"
      : initialUsage.searchesToday >= initialUsage.searchesLimit
        ? "DAILY_LIMIT"
        : null;
  const [blocked, setBlocked] = useState<"QUOTA_EXCEEDED" | "DAILY_LIMIT" | "NO_PLAN" | null>(initialBlock);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "completude", dir: -1 });

  const abortRef = useRef<AbortController | null>(null);
  const lastQuery = useRef({ niche: "", city: "" });

  async function runSearch(n = niche, c = city) {
    if (n.trim().length < 2 || c.trim().length < 2) {
      setError("Preencha o nicho e a cidade.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastQuery.current = { niche: n.trim(), city: c.trim() };

    setLoading(true);
    setCancelled(false);
    setError("");
    setLeads([]);
    setMeta(null);
    setProgress(3);
    setStatusMsg("Iniciando busca…");
    setLog([]);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: n, city: c, limit, enrich }),
        signal: controller.signal,
      });
      if (res.status === 402) {
        const j = await res.json().catch(() => ({}));
        if (j.usage) setUsage(j.usage);
        if (j.code === "QUOTA_EXCEEDED" || j.code === "DAILY_LIMIT") {
          setBlocked(j.code);
          setProgress(0);
          return;
        }
        window.location.href = "/dashboard";
        return;
      }
      if (res.status === 401) {
        window.location.href = "/dashboard";
        return;
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Erro ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotResult = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as StreamEvent;
          if (ev.type === "status") {
            setProgress((p) => Math.max(p, ev.progress));
            setStatusMsg(ev.message);
            setLog((l) => (l[l.length - 1] === ev.message ? l : [...l.slice(-30), ev.message]));
          } else if (ev.type === "partial") {
            setLeads(ev.leads);
          } else if (ev.type === "result") {
            gotResult = true;
            setLeads(ev.leads);
            setMeta({ source: ev.source, elapsedMs: ev.elapsedMs, enriched: ev.enriched });
            if (ev.usage) {
              setUsage(ev.usage);
              if (!ev.usage.unlimited && ev.usage.leadsRemaining <= 0) setBlocked("QUOTA_EXCEEDED");
            }
            setProgress(100);
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }
      }
      if (!gotResult) throw new Error("A busca foi interrompida antes de terminar. Os resultados parciais estão abaixo.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      // só a busca atual mexe no estado; uma busca antiga abortada não pode desligar a nova
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  function stop() {
    // fecha a conexão: o servidor percebe e interrompe a busca de verdade (sem gastar API nem leads)
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setCancelled(true);
    setStatusMsg("Busca cancelada.");
    // o servidor acerta a cota ao perceber o cancelamento; atualiza o medidor daqui a pouco
    setTimeout(() => {
      fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (j?.user?.usage) setUsage(j.user.usage);
        })
        .catch(() => {});
    }, 2000);
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = leads.filter((l) => {
      if (filter === "telefone" && !l.telefone) return false;
      if (filter === "whatsapp" && !l.whatsapp) return false;
      if (filter === "email" && !l.email) return false;
      if (filter === "website" && !l.website) return false;
      if (!q) return true;
      return [l.nome, l.categoria, l.endereco, l.email, l.telefone].some((v) => v?.toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      const { key, dir } = sort;
      if (key === "completude") return (completeness(a) - completeness(b)) * dir;
      if (key === "avaliacao") return ((a.avaliacao ?? -1) - (b.avaliacao ?? -1)) * dir;
      return String(a[key]).localeCompare(String(b[key]), "pt-BR") * dir;
    });
    return list;
  }, [leads, query, filter, sort]);

  const stats = useMemo(
    () => ({
      total: leads.length,
      telefone: leads.filter((l) => l.telefone).length,
      whatsapp: leads.filter((l) => l.whatsapp).length,
      email: leads.filter((l) => l.email).length,
      website: leads.filter((l) => l.website).length,
    }),
    [leads],
  );

  const fileBase = slugify(`${lastQuery.current.niche}-${lastQuery.current.city}`) || "leads";

  function exportCsv() {
    download(new Blob([leadsToCsv(visible)], { type: "text/csv;charset=utf-8" }), `${fileBase}.csv`);
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: visible, ...lastQuery.current }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Falha ao gerar XLSX");
      download(await res.blob(), `${fileBase}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "nome" || key === "categoria" ? 1 : -1 }));

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-4 sm:px-6 lg:px-10">
      {/* Cabeçalho */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-ink-line bg-ink-soft/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-lime">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" /> LeadHunter
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Leads de empresas locais, <span className="text-lime">prontos pra prospectar.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Busque por nicho e cidade, enriqueça com e-mail, WhatsApp e redes sociais do site de cada empresa e exporte em CSV ou XLSX.
          </p>
        </div>
      </header>

      <UsageMeter usage={usage} />
      {blocked && <UpgradePanel usage={usage} reason={blocked} />}

      {/* Formulário */}
      <section className="rounded-2xl border border-ink-line bg-ink/80 p-4 shadow-2xl shadow-black/30 backdrop-blur sm:p-5">
        <form
          className="grid gap-3 md:grid-cols-[1.3fr_1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <label className="group relative block">
            <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-zinc-500">Nicho</span>
            <Building2 className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-zinc-500 group-focus-within:text-lime" />
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Clínicas Estéticas"
              maxLength={80}
              className="h-11 w-full rounded-xl border border-ink-line bg-ink-soft pl-9 pr-3 text-[15px] text-white outline-none transition placeholder:text-zinc-600 focus:border-lime/60 focus:ring-2 focus:ring-lime/20"
            />
          </label>
          <label className="group relative block">
            <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-zinc-500">Cidade / Região</span>
            <MapPin className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-zinc-500 group-focus-within:text-lime" />
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Indaiatuba, SP"
              maxLength={80}
              className="h-11 w-full rounded-xl border border-ink-line bg-ink-soft pl-9 pr-3 text-[15px] text-white outline-none transition placeholder:text-zinc-600 focus:border-lime/60 focus:ring-2 focus:ring-lime/20"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-zinc-500">Máx.</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-11 w-full rounded-xl border border-ink-line bg-ink-soft px-3 text-[15px] text-white outline-none focus:border-lime/60 md:w-24"
            >
              {[20, 40, 60, 100, 150, 200].map((n) => (
                <option key={n} value={n} disabled={!usage.unlimited && n > Math.max(20, usage.leadsRemaining)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            {loading ? (
              <button
                key="stop"
                type="button"
                onClick={(e) => {
                  // sem isto o clique virava um "enviar formulário" e reiniciava a busca
                  e.preventDefault();
                  stop();
                }}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink-line bg-ink-soft px-5 font-medium text-zinc-200 transition hover:border-red-400/50 hover:text-red-300 md:w-auto"
              >
                <Square className="h-4 w-4" /> Parar
              </button>
            ) : (
              <button
                key="search"
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime px-6 font-semibold text-ink transition hover:bg-[#c2f25c] active:scale-[0.98] md:w-auto"
              >
                <Search className="h-4 w-4" /> Buscar leads
              </button>
            )}
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">Exemplos:</span>
            {EXAMPLES.map(([n, c]) => (
              <button
                key={n + c}
                type="button"
                disabled={loading}
                onClick={() => {
                  setNiche(n);
                  setCity(c);
                  runSearch(n, c);
                }}
                className="rounded-full border border-ink-line px-2.5 py-1 text-xs text-zinc-400 transition hover:border-lime/40 hover:text-lime disabled:opacity-40"
              >
                {n} · {c.split(",")[0]}
              </button>
            ))}
          </div>
          <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="accent-[#A9EA2E]" />
            <Sparkles className="h-3.5 w-3.5 text-lime" /> Enriquecer pelos sites (e-mail, redes, WhatsApp)
          </label>
        </div>

        {/* Progresso */}
        {(loading || progress > 0) && (
          <div className="mt-4 rounded-xl border border-ink-line bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                {loading ? (
                  <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-lime" />
                ) : cancelled ? (
                  <Square className="h-4 w-4 shrink-0 text-zinc-500" />
                ) : error ? (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
                ) : (
                  <CircleCheck className="h-4 w-4 shrink-0 text-lime" />
                )}
                <span className="truncate">{statusMsg}</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-zinc-500">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-line">
              <div className="relative h-full rounded-full bg-lime transition-all duration-500" style={{ width: `${progress}%` }}>
                {loading && <div className="progress-shimmer absolute inset-0" />}
              </div>
            </div>
            {meta && (
              <p className="mt-2 font-mono text-[11px] text-zinc-500">
                fonte: {SOURCE_LABEL[meta.source] || meta.source} · {meta.enriched} sites analisados ·{" "}
                {(meta.elapsedMs / 1000).toFixed(1)}s
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} aria-label="Fechar">
              <X className="h-4 w-4 opacity-60 hover:opacity-100" />
            </button>
          </div>
        )}
      </section>

      {/* Estatísticas */}
      {leads.length > 0 && (
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["Leads", stats.total, Building2, "todos"],
              ["Com telefone", stats.telefone, Phone, "telefone"],
              ["Com WhatsApp", stats.whatsapp, MessageCircle, "whatsapp"],
              ["Com e-mail", stats.email, Mail, "email"],
              ["Com site", stats.website, Globe, "website"],
            ] as const
          ).map(([label, value, Icon, f]) => (
            <button
              key={label}
              onClick={() => setFilter(f)}
              className={`rounded-xl border p-3 text-left transition ${
                filter === f ? "border-lime/50 bg-lime/[0.06]" : "border-ink-line bg-ink/60 hover:border-zinc-600"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
                {value}
                {f !== "todos" && stats.total > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-zinc-500">{Math.round((value / stats.total) * 100)}%</span>
                )}
              </div>
            </button>
          ))}
        </section>
      )}

      {/* Tabela */}
      {leads.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-2xl border border-ink-line bg-ink/70">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-line p-3">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar por nome, endereço, e-mail…"
                className="h-9 w-full rounded-lg border border-ink-line bg-ink-soft pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden font-mono text-xs text-zinc-500 sm:inline">{visible.length} linhas</span>
              <button
                onClick={exportCsv}
                disabled={!visible.length}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-line bg-ink-soft px-3 text-sm text-zinc-200 transition hover:border-lime/50 hover:text-lime disabled:opacity-40"
              >
                <FileText className="h-4 w-4" /> CSV
              </button>
              <button
                onClick={exportXlsx}
                disabled={!visible.length || exporting}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-lime px-3 text-sm font-semibold text-ink transition hover:bg-[#c2f25c] disabled:opacity-50"
              >
                {exporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} XLSX
              </button>
            </div>
          </div>

          <div className="scrollbar-thin max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-ink-soft text-left font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <Th onClick={() => toggleSort("nome")} active={sort.key === "nome"}>Estabelecimento</Th>
                  <Th onClick={() => toggleSort("categoria")} active={sort.key === "categoria"}>Categoria</Th>
                  <th className="px-3 py-2.5 font-medium">Contato</th>
                  <th className="px-3 py-2.5 font-medium">Site / E-mail</th>
                  <th className="px-3 py-2.5 font-medium">Redes</th>
                  <Th onClick={() => toggleSort("avaliacao")} active={sort.key === "avaliacao"}>Nota</Th>
                  <Th onClick={() => toggleSort("completude")} active={sort.key === "completude"}>Dados</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.id} className="border-t border-ink-line/70 align-top transition hover:bg-white/[0.02]">
                    <td className="max-w-[320px] px-3 py-3">
                      <div className="font-medium text-white">{l.nome}</div>
                      {l.endereco && (
                        <div className="mt-0.5 flex items-start gap-1 text-xs text-zinc-500">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          {l.latitude != null ? (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.nome + " " + l.endereco)}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="hover:text-zinc-300"
                            >
                              {l.endereco}
                            </a>
                          ) : (
                            l.endereco
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-md border border-ink-line px-1.5 py-0.5 text-xs text-zinc-400">{l.categoria}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {l.telefone && (
                        <div className="flex items-center gap-1.5 text-zinc-300">
                          <Phone className="h-3 w-3 text-zinc-500" />
                          <span title={l.telefone}>{prettyPhone(l.telefone)}</span>
                        </div>
                      )}
                      {l.whatsapp && (
                        <a
                          href={`https://wa.me/${l.whatsapp}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300"
                        >
                          <MessageCircle className="h-3 w-3" /> {l.whatsapp}
                        </a>
                      )}
                      {!l.telefone && !l.whatsapp && <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="max-w-[260px] px-3 py-3 text-xs">
                      {l.website && (
                        <a href={safeHref(l.website)} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 truncate text-sky-300 hover:text-sky-200">
                          <Globe className="h-3 w-3 shrink-0" />
                          <span className="truncate">{l.website.replace(/^https?:\/\/(www\.)?/, "")}</span>
                        </a>
                      )}
                      {l.email && (
                        <a href={`mailto:${l.email}`} className="mt-1 flex items-center gap-1.5 truncate text-zinc-300 hover:text-white">
                          <Mail className="h-3 w-3 shrink-0 text-zinc-500" />
                          <span className="truncate">{l.email}</span>
                        </a>
                      )}
                      {!l.website && !l.email && <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className="flex flex-col gap-1">
                        {(
                          [
                            ["IG", l.instagram],
                            ["FB", l.facebook],
                            ["IN", l.linkedin],
                            ["TT", l.tiktok],
                            ["YT", l.youtube],
                          ] as const
                        )
                          .filter(([, u]) => u)
                          .map(([tag, u]) => (
                            <a key={tag} href={safeHref(u)} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 text-zinc-400 hover:text-lime">
                              <span className="w-5 font-mono text-[10px] text-zinc-600">{tag}</span>
                              <AtSign className="h-3 w-3" />
                              <span className="max-w-[140px] truncate">{handle(u).replace(/^@/, "")}</span>
                            </a>
                          ))}
                        {![l.instagram, l.facebook, l.linkedin, l.tiktok, l.youtube].some(Boolean) && <span className="text-zinc-600">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {l.avaliacao != null ? (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <Star className="h-3 w-3 fill-current" /> {l.avaliacao.toFixed(1)}
                          {l.totalAvaliacoes != null && <span className="text-zinc-500">({l.totalAvaliacoes})</span>}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Completeness value={completeness(l)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">Nenhum lead com esse filtro.</p>}
          </div>
        </section>
      )}

      {/* Estado vazio */}
      {!leads.length && !loading && (
        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            [Search, "1. Busque", "Nicho + cidade. A busca roda numa função serverless e mostra o progresso em tempo real."],
            [Sparkles, "2. Enriqueça", "Visitamos o site de cada empresa para achar e-mail, WhatsApp, Instagram, Facebook e LinkedIn."],
            [Download, "3. Exporte", "CSV (UTF-8 com BOM, pronto para Excel) ou XLSX formatado, sem duplicatas."],
          ].map(([Icon, title, text]) => {
            const I = Icon as typeof Search;
            return (
              <div key={title as string} className="rounded-2xl border border-dashed border-ink-line p-5">
                <I className="h-5 w-5 text-lime" />
                <h3 className="mt-3 font-medium text-white">{title as string}</h3>
                <p className="mt-1 text-sm text-zinc-500">{text as string}</p>
              </div>
            );
          })}
        </section>
      )}

      {log.length > 1 && (
        <details className="mt-6 text-xs text-zinc-500">
          <summary className="cursor-pointer select-none font-mono">log da busca ({log.length})</summary>
          <ol className="mt-2 space-y-0.5 font-mono">
            {log.map((m, i) => (
              <li key={i}>
                <span className="text-zinc-700">{String(i + 1).padStart(2, "0")}</span> {m}
              </li>
            ))}
          </ol>
        </details>
      )}
    </main>
  );
}

function Th({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return (
    <th className="px-3 py-2.5 font-medium">
      <button onClick={onClick} className={`inline-flex items-center gap-1 uppercase ${active ? "text-lime" : "hover:text-zinc-300"}`}>
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

function Completeness({ value }: { value: number }) {
  const max = 7;
  return (
    <div className="flex items-center gap-1.5" title={`${value}/${max} campos preenchidos`}>
      <div className="flex gap-0.5">
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} className={`h-3 w-1 rounded-sm ${i < value ? "bg-lime" : "bg-ink-line"}`} />
        ))}
      </div>
      <span className="font-mono text-[10px] text-zinc-500">{value}</span>
    </div>
  );
}
