import { NextRequest } from "next/server";
import { requirePaidUser } from "@/lib/auth";
import ExcelJS from "exceljs";
import { EXPORT_COLUMNS, type Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Evita injeção de fórmula ao abrir a planilha no Excel (CSV/Formula injection). */
function safeCell(v: unknown): string | number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").slice(0, 2000);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export async function POST(req: NextRequest) {
  const guard = await requirePaidUser(req);
  if ("response" in guard) return guard.response;

  let body: { leads?: Lead[]; niche?: string; city?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }
  const leads = Array.isArray(body.leads) ? body.leads.slice(0, 2000) : [];
  if (!leads.length) return Response.json({ error: "Nenhum lead para exportar." }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "LeadHunter";
  wb.created = new Date();
  const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = EXPORT_COLUMNS.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.key === "endereco" ? 48 : c.key === "nome" ? 34 : ["website", "instagram", "facebook", "linkedin", "tiktok", "youtube"].includes(c.key) ? 36 : 18,
  }));

  for (const l of leads) {
    const row: Record<string, string | number> = {};
    for (const c of EXPORT_COLUMNS) {
      const v = l[c.key];
      row[c.key] = v === null || v === undefined ? "" : safeCell(v);
    }
    const added = ws.addRow(row);
    // telefones como texto para o Excel não converter em notação científica
    ["telefone", "whatsapp"].forEach((k) => {
      const cell = added.getCell(k);
      cell.numFmt = "@";
      if (cell.value) cell.value = String(cell.value);
    });
    ["website", "instagram", "facebook", "linkedin", "tiktok", "youtube"].forEach((k) => {
      const cell = added.getCell(k);
      const url = String(cell.value || "");
      if (/^https?:\/\//.test(url)) cell.value = { text: url, hyperlink: url };
    });
    const wa = added.getCell("whatsapp");
    if (wa.value) wa.value = { text: String(wa.value), hyperlink: `https://wa.me/${wa.value}` };
  }

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FF0F1412" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8F169" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };

  const buffer = await wb.xlsx.writeBuffer();
  const slug = `${body.niche || "leads"}-${body.city || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug || "leads"}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
