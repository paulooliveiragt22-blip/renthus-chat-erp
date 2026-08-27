"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/PasswordInput";

export default function PlatformLoginPage() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const { data, error: signErr } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
            });
            if (signErr || !data.session) {
                setError(signErr?.message ?? "Credenciais inválidas");
                return;
            }

            await fetch("/api/auth/sync-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                }),
            });

            const meRes = await fetch("/api/platform/me");
            if (!meRes.ok) {
                await supabase.auth.signOut();
                const body = await meRes.json().catch(() => ({}));
                setError(body.error ?? "Conta sem acesso platform");
                return;
            }

            const me = await meRes.json();
            if (me.mfa?.required && !me.mfa?.satisfied) {
                router.push("/platform/login/mfa");
                return;
            }

            router.push("/platform");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
            <div className="w-full max-w-sm">
                <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="mb-6 flex flex-col items-center gap-2">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg">
                            <Shield className="h-7 w-7 text-white" />
                        </div>
                        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                            Platform Admin
                        </h1>
                        <p className="text-xs text-zinc-400">Renthus / Lysthub — acesso restrito</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                E-mail
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                Senha
                            </label>
                            <PasswordInput
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>

                        {error && (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-primary-light disabled:opacity-50"
                        >
                            {loading ? "Entrando…" : "Entrar"}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
