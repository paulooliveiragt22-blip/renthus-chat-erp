"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/PasswordInput";

export default function SetPasswordClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const nextParam = searchParams.get("next");
    const next =
        nextParam?.startsWith("/") && !nextParam.startsWith("//")
            ? nextParam
            : "/platform/login";

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        if (password.length < 8) {
            setError("A senha deve ter pelo menos 8 caracteres.");
            return;
        }
        if (password !== confirm) {
            setError("As senhas não coincidem.");
            return;
        }

        setLoading(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            if (!sessionData.session) {
                setError(
                    "Sessão expirada. Peça um novo convite ou use “Esqueci minha senha”."
                );
                return;
            }

            const { error: updErr } = await supabase.auth.updateUser({ password });
            if (updErr) {
                setError(updErr.message);
                return;
            }

            const { data: refreshed } = await supabase.auth.getSession();
            if (refreshed.session) {
                await fetch("/api/auth/sync-session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        access_token: refreshed.session.access_token,
                        refresh_token: refreshed.session.refresh_token,
                    }),
                });
            }

            router.replace(next);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    Definir senha
                </h1>
                <p className="mt-1 text-xs text-zinc-500">
                    Crie a senha da sua conta para acessar o painel.
                </p>

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            Nova senha
                        </label>
                        <PasswordInput value={password} onChange={setPassword} />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            Confirmar senha
                        </label>
                        <PasswordInput value={confirm} onChange={setConfirm} />
                    </div>

                    {error && (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                        {loading ? "Salvando…" : "Salvar e continuar"}
                    </button>
                </form>
            </div>
        </div>
    );
}
