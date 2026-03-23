// app/offline/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sem conexão — Renthus ERP",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 text-center dark:bg-zinc-950">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-10 w-10 text-violet-600 dark:text-violet-400"
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
          Verifique sua rede e tente novamente. Alguns dados podem estar
          disponíveis em cache.
        </p>
      </div>

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-violet-700 transition-colors"
      >
        Tentar novamente
      </Link>
    </div>
  );
}
