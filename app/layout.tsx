import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadHunter — Leads de empresas locais",
  description: "Encontre, enriqueça e exporte leads de empresas locais por nicho e cidade.",
};

export const viewport: Viewport = {
  themeColor: "#0b0f0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
