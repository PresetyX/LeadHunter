import { EXPORT_COLUMNS, type Lead } from "./types.ts";

function escapeCsv(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function leadsToCsv(leads: Lead[]): string {
  const header = EXPORT_COLUMNS.map((c) => escapeCsv(c.label)).join(";");
  const rows = leads.map((l) =>
    EXPORT_COLUMNS.map((c) => {
      const v = l[c.key];
      if ((c.key === "telefone" || c.key === "whatsapp") && v && /^\d+$/.test(String(v))) return `="${v}"`;
      if (c.key === "avaliacao" && typeof v === "number") return String(v).replace(".", ",");
      return escapeCsv(v);
    }).join(";"),
  );
  return "﻿" + [header, ...rows].join("\r\n");
}
