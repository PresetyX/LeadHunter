"use client";

import { useEffect, useState } from "react";
import { Clock, LoaderCircle } from "lucide-react";
import Pricing from "./Pricing";
import type { PricingMode } from "@/lib/pricing";

/**
 * Ao voltar do Mercado Pago (?payment_id=…), confirma o pagamento no servidor e recarrega o
 * painel quando liberado. Serve para qualquer compra: vitalício, pacote de leads ou plano mensal.
 */
export function PaymentReturn({ checkout, paymentId }: { checkout?: string; paymentId?: string }) {
  const [verifying, setVerifying] = useState(Boolean(paymentId));
  const [notice, setNotice] = useState(
    checkout === "pending"
      ? "Pagamento em processamento. Pix costuma confirmar em segundos; boleto pode levar até 3 dias úteis."
      : checkout === "failure"
        ? "O pagamento não foi concluído. Você pode tentar novamente."
        : "",
  );

  useEffect(() => {
    if (!paymentId) return;
    let tries = 0;
    let stop = false;
    const check = async () => {
      tries++;
      const res = await fetch("/api/checkout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (json.paid) {
        window.location.replace(`/dashboard?welcome=${encodeURIComponent(json.product || "1")}`);
        return;
      }
      if (json.status === "pending" || json.status === "in_process") {
        setNotice("Pagamento em processamento. Esta página atualiza sozinha quando for aprovado.");
      }
      if (!stop && tries < 20) setTimeout(check, 3000);
      else setVerifying(false);
    };
    check();
    return () => {
      stop = true;
    };
  }, [paymentId]);

  if (!verifying && !notice) return null;
  return (
    <div className="mx-auto mb-6 flex max-w-lg items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-200">
      {verifying ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0" />}
      {verifying ? "Confirmando seu pagamento com o Mercado Pago…" : notice}
    </div>
  );
}

export default function Paywall({
  checkout,
  paymentId,
  mode,
  slotsLeft,
  devToggle,
}: {
  checkout?: string;
  paymentId?: string;
  mode: PricingMode;
  slotsLeft: number;
  devToggle: boolean;
}) {
  return (
    <div>
      <PaymentReturn checkout={checkout} paymentId={paymentId} />
      <Pricing mode={mode} slotsLeft={slotsLeft} devToggle={devToggle} loggedIn />
    </div>
  );
}
