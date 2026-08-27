"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PlatformMfaPage() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function verify() {
        setError("");
        setLoading(true);
        try {
            const factors = await supabase.auth.mfa.listFactors();
            if (factors.error) throw factors.error;

            const totp = factors.data.totp[0];
            if (!totp) {
                setError("Nenhum fator TOTP cadastrado. Configure MFA no Supabase Auth.");
                return;
            }

            const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id });
            if (challenge.error) throw challenge.error;

            const verify = await supabase.auth.mfa.verify({
                factorId: totp.id,
                challengeId: challenge.data.id,
                code: code.trim(),
            });
            if (verify.error) throw verify.error;

            await supabase.auth.refreshSession();
            router.push("/platform");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Código inválido");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    Verificação MFA
                </h1>
                <p className="mt-1 text-xs text-zinc-500">
                    Digite o código do autenticador (obrigatório para ops/superadmin).
                </p>

                <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="mt-4 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-3 text-center text-lg tracking-widest outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />

                {error && (
                    <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
                )}

                <button
                    type="button"
                    disabled={code.length !== 6 || loading}
                    onClick={verify}
                    className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                    {loading ? "Verificando…" : "Confirmar"}
                </button>
            </div>
        </div>
    );
}
