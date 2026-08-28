"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Loader2, Rocket } from "lucide-react";

const STEPS = [
    "Boas-vindas",
    "Dados da loja",
    "WhatsApp e canais",
    "Primeiro produto",
    "Testar o bot",
    "Pronto!",
] as const;

export default function AtivarPage() {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [nomeFantasia, setNomeFantasia] = useState("");
    const [whatsapp, setWhatsapp] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch("/api/ativar", { credentials: "include", cache: "no-store" });
            const json = await res.json();
            if (!res.ok) {
                setErr(json.error ?? "Não foi possível carregar o onboarding.");
                return;
            }
            if (json.completed) {
                router.replace("/pedidos");
                return;
            }
            setStep(Number(json.step) || 0);
            setNomeFantasia(json.company?.nome_fantasia ?? "");
            setWhatsapp(json.company?.whatsapp_phone ?? "");
        } catch {
            setErr("Erro de rede.");
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        load().catch(() => {});
    }, [load]);

    async function persistStep(next: number) {
        setSaving(true);
        setErr(null);
        try {
            const res = await fetch("/api/ativar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ action: "advance", step: next }),
            });
            const json = await res.json();
            if (!res.ok) {
                setErr(json.error ?? "Erro ao salvar progresso.");
                return false;
            }
            setStep(next);
            return true;
        } catch {
            setErr("Erro de rede.");
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function finish(skip = false) {
        setSaving(true);
        setErr(null);
        try {
            const res = await fetch("/api/ativar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ action: skip ? "skip" : "complete" }),
            });
            const json = await res.json();
            if (!res.ok) {
                setErr(json.error ?? "Erro ao concluir.");
                return;
            }
            router.replace("/pedidos");
        } catch {
            setErr("Erro de rede.");
        } finally {
            setSaving(false);
        }
    }

    async function saveStoreAndNext() {
        if (nomeFantasia.trim().length < 2) {
            setErr("Informe o nome fantasia da loja.");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/companies/update", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    nome_fantasia: nomeFantasia.trim(),
                    whatsapp_phone: whatsapp.replaceAll(/\D/g, ""),
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setErr(j.error ?? "Erro ao salvar dados.");
                return;
            }
            await persistStep(2);
        } catch {
            setErr("Erro de rede.");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Ativar sua loja</h1>
                <p className="mt-1 text-sm text-zinc-500">
                    Passo {step + 1} de {STEPS.length} — {STEPS[step]}
                </p>
                <div className="mt-4 flex gap-1">
                    {STEPS.map((_, i) => (
                        <div
                            key={STEPS[i]}
                            className={`h-1.5 flex-1 rounded-full ${
                                i <= step ? "bg-violet-600" : "bg-zinc-200 dark:bg-zinc-700"
                            }`}
                        />
                    ))}
                </div>
            </div>

            {err && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                    {err}
                </div>
            )}

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                {step === 0 && (
                    <>
                        <Rocket className="mb-3 h-10 w-10 text-violet-600" />
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                            Bem-vindo ao RenthusAgent
                        </h2>
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            Em poucos minutos você configura WhatsApp, cardápio e pode receber o
                            primeiro pedido. Pode pular etapas e voltar depois em Configurações.
                        </p>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => persistStep(1).catch(() => {})}
                            className="mt-6 flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                        >
                            Começar
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </>
                )}

                {step === 1 && (
                    <>
                        <h2 className="text-lg font-bold">Dados da loja</h2>
                        <div className="mt-4 flex flex-col gap-3">
                            <label className="text-xs font-semibold text-zinc-600">
                                Nome fantasia
                                <input
                                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                    value={nomeFantasia}
                                    onChange={(e) => setNomeFantasia(e.target.value)}
                                />
                            </label>
                            <label className="text-xs font-semibold text-zinc-600">
                                WhatsApp comercial
                                <input
                                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                    value={whatsapp}
                                    onChange={(e) => setWhatsapp(e.target.value)}
                                    placeholder="(66) 99999-9999"
                                />
                            </label>
                        </div>
                        <div className="mt-6 flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => saveStoreAndNext().catch(() => {})}
                                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                            >
                                {saving ? "Salvando…" : "Continuar"}
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(2).catch(() => {})}
                                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-500 hover:text-zinc-800"
                            >
                                Pular
                            </button>
                        </div>
                    </>
                )}

                {step === 2 && (
                    <>
                        <h2 className="text-lg font-bold">WhatsApp e canais</h2>
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            Conecte seu número em Configurações → Canais. Você precisará do
                            WhatsApp Business e aprovação Meta.
                        </p>
                        <Link
                            href="/configuracoes?tab=canais"
                            className="mt-4 inline-flex rounded-xl border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300"
                        >
                            Abrir Configurações → Canais
                        </Link>
                        <div className="mt-6 flex gap-2">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(3).catch(() => {})}
                                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white"
                            >
                                Continuar
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(3).catch(() => {})}
                                className="text-sm font-semibold text-zinc-500"
                            >
                                Pular
                            </button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <h2 className="text-lg font-bold">Cadastre um produto</h2>
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            Pelo menos um item no cardápio para o bot oferecer no WhatsApp.
                        </p>
                        <Link
                            href="/produtos/lista"
                            className="mt-4 inline-flex rounded-xl border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-700"
                        >
                            Ir para Produtos
                        </Link>
                        <div className="mt-6 flex gap-2">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(4).catch(() => {})}
                                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white"
                            >
                                Continuar
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(4).catch(() => {})}
                                className="text-sm font-semibold text-zinc-500"
                            >
                                Pular
                            </button>
                        </div>
                    </>
                )}

                {step === 4 && (
                    <>
                        <h2 className="text-lg font-bold">Teste o bot</h2>
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            Envie uma mensagem para o número conectado ou use o simulador em
                            Configurações → Chatbot.
                        </p>
                        <Link
                            href="/configuracoes?tab=chatbot"
                            className="mt-4 inline-flex rounded-xl border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-700"
                        >
                            Abrir Chatbot
                        </Link>
                        <div className="mt-6 flex gap-2">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(5).catch(() => {})}
                                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white"
                            >
                                Continuar
                            </button>
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => persistStep(5).catch(() => {})}
                                className="text-sm font-semibold text-zinc-500"
                            >
                                Pular
                            </button>
                        </div>
                    </>
                )}

                {step === 5 && (
                    <>
                        <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-600" />
                        <h2 className="text-lg font-bold">Tudo pronto!</h2>
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            Sua loja está configurada. Acompanhe pedidos na fila e ajuste o resto
                            quando quiser.
                        </p>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => finish(false).catch(() => {})}
                            className="mt-6 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                        >
                            {saving ? "Finalizando…" : "Ir para Pedidos"}
                        </button>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => finish(true).catch(() => {})}
                            className="mt-3 block text-sm font-semibold text-zinc-500"
                        >
                            Concluir depois
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
