"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";

export default function SuperAdminLoginPage() {
    const router   = useRouter();
    const [pw, setPw]       = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await fetch("/api/superadmin/login", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ password: pw }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "Senha incorreta");
                return;
            }
            router.push("/superadmin/empresas");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-950 px-4">
            <div className="w-full max-w-sm">
                {/* Card */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                    {/* Ícone */}
                    <div className="mb-6 flex flex-col items-center gap-2">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg">
                            <Shield className="h-7 w-7 text-white" />
                        </div>
                        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                            Super Admin
                        </h1>
                        <p className="text-xs text-zinc-400">Acesso restrito — somente local</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                Senha de acesso
                            </label>
                            <input
                                type="password"
                                value={pw}
                                onChange={(e) => setPw(e.target.value)}
                                placeholder="••••••••••"
                                autoFocus
                                required
                                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                            />
                        </div>

                        {error && (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !pw}
                            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-primary-light disabled:opacity-50"
                        >
                            {loading ? "Entrando…" : "Entrar"}
                        </button>
                    </form>
                </div>

                <p className="mt-4 text-center text-[11px] text-zinc-400">
                    Configure <code className="font-mono font-bold">SUPERADMIN_SECRET</code> no <code className="font-mono">.env.local</code>
                </p>
            </div>
        </div>
    );
}
