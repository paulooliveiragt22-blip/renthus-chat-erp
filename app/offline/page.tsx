// app/offline/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sem conexão — RenthusAgent",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 text-center dark:bg-zinc-950">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-10 w-10 text-amber-700 dark:text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3l18 18M8.11 8.11A7 7 0 0116.9 16.9M1.42 1.42l.01.01M5.64 5.64A9.95 9.95 0 003 12a10 10 0 0017.66 6.48M12 2a10 10 0 016.36 2.3"
          />
        </svg>
      </div>

      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          Sem conexão com a internet
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          O PDV pode continuar com o catálogo em cache e vendas na fila
          local. Assim que a rede voltar, as pendências sincronizam
          automaticamente.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/pdv"
          className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-orange-700 transition-colors"
        >
          Ir ao PDV
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Tentar novamente
        </Link>
      </div>
    </div>
  );
}
