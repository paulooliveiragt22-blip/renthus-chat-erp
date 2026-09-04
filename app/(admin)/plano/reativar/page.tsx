"use client";
import Link from "next/link";
import { useState } from "react";
export default function PlanoReativarPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [success, setSuccess] = useState<{trialEndsAt:string;message:string}|null>(null);
  async function handleReactivate() {
    setLoading(true); setError(null); setSuccess(null);
    try {
      const statusRes = await fetch("/api/billing/status", { cache: "no-store" });
      if (!statusRes.ok) throw new Error("Não foi possível identificar sua empresa. Faça login novamente.");
      const status = await statusRes.json();
      const companyId = status.company_id as string|undefined;
      if (!companyId) throw new Error("Você não tem empresa vinculada a esta conta.");
      const res = await fetch("/api/billing/self-reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao reativar");
      setSuccess({ trialEndsAt: data.trialEndsAt, message: data.message });
      setTimeout(() => { window.location.href = data.redirectTo ?? "/plano/pagar"; }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <img src="/brand/zampell-wordmark.png?v=z1" alt="Zampell" className="h-7 w-auto dark:hidden" />
          <img src="/brand/zampell-wordmark.png?v=z1" alt="Zampell" className="hidden h-7 w-auto dark:block" />
          <Link href="/logout" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Sair</Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Reativar sua loja</h1>
          <p className="mt-1 text-sm text-zinc-500">Detectamos que sua assinatura estava inativa. Você pode reativar agora e ganhar um novo período de teste para concluir a configuração e o pagamento.</p>
        </div>
        {success ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
            <h2 className="text-base font-semibold text-green-900 dark:text-green-100">Reativação realizada!</h2>
            <p className="mt-2 text-sm text-green-800 dark:text-green-200">{success.message}</p>
            <p className="mt-2 text-xs text-green-700 dark:text-green-300">Redirecionando para o pagamento...</p>
          </div>
        ) : (
          <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-zinc-900">
            <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <strong>Importante:</strong> Esta reativação é única. Para manter sua loja ativa após o período de teste, você precisa concluir o pagamento.
            </div>
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>
            )}
            <button onClick={handleReactivate} disabled={loading} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Reativando..." : "Reativar agora"}
            </button>
            <p className="mt-3 text-center text-xs text-zinc-500">Reativações têm cooldown de 60 dias.</p>
          </div>
        )}
      </main>
    </div>
  );
}
