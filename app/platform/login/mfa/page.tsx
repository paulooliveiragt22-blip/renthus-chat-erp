"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Phase = "loading" | "enroll" | "challenge";

export default function PlatformMfaPage() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const [phase, setPhase] = useState<Phase>("loading");
    const [factorId, setFactorId] = useState<string | null>(null);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [secret, setSecret] = useState<string | null>(null);
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const factors = await supabase.auth.mfa.listFactors();
            if (cancelled) return;
            if (factors.error) {
                setError(factors.error.message);
                setPhase("enroll");
                return;
            }

            const verified = factors.data.totp.find((f) => f.status === "verified");
            if (verified) {
                setFactorId(verified.id);
                setPhase("challenge");
                return;
            }

            // Remove fatores unverified órfãos antes de re-enroll
            const orphaned = [
                ...(factors.data.totp ?? []),
                ...(factors.data.phone ?? []),
            ].filter((f) => f.status === "unverified");
            for (const f of orphaned) {
                await supabase.auth.mfa.unenroll({ factorId: f.id });
            }

            const enrolled = await supabase.auth.mfa.enroll({
                factorType: "totp",
                friendlyName: "platform-admin",
            });
            if (cancelled) return;
            if (enrolled.error || !enrolled.data) {
                setError(enrolled.error?.message ?? "Falha ao iniciar enroll MFA");
                setPhase("enroll");
                return;
            }

            setFactorId(enrolled.data.id);
            setQrCode(enrolled.data.totp.qr_code);
            setSecret(enrolled.data.totp.secret);
            setPhase("enroll");
        })();
        return () => {
            cancelled = true;
        };
    }, [supabase]);

    async function verify() {
        if (!factorId || code.trim().length !== 6) return;
        setError("");
        setLoading(true);
        try {
            const challenge = await supabase.auth.mfa.challenge({ factorId });
            if (challenge.error) throw challenge.error;

            const verified = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challenge.data.id,
                code: code.trim(),
            });
            if (verified.error) throw verified.error;

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
                    {phase === "enroll" ? "Configurar autenticador" : "Verificação MFA"}
                </h1>
                <p className="mt-1 text-xs text-zinc-500">
                    {phase === "enroll"
                        ? "Escaneie o QR no Google Authenticator / 1Password e digite o código de 6 dígitos."
                        : "Digite o código do autenticador (obrigatório para ops/superadmin)."}
                </p>

                {phase === "loading" && (
                    <p className="mt-6 text-center text-sm text-zinc-400">Preparando MFA…</p>
                )}

                {phase === "enroll" && qrCode && (
                    <div className="mt-4 flex flex-col items-center gap-3">
                        {/* qr_code do Supabase é SVG data URL */}
                        <img
                            src={qrCode}
                            alt="QR Code MFA"
                            className="h-48 w-48 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700"
                        />
                        {secret ? (
                            <p className="break-all text-center font-mono text-[10px] text-zinc-500">
                                Secret: {secret}
                            </p>
                        ) : null}
                    </div>
                )}

                {phase !== "loading" && (
                    <>
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
                            disabled={code.length !== 6 || loading || !factorId}
                            onClick={verify}
                            className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {loading
                                ? "Verificando…"
                                : phase === "enroll"
                                  ? "Confirmar e ativar"
                                  : "Confirmar"}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
