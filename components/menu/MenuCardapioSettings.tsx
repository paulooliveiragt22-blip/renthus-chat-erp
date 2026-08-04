"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, QrCode, Save } from "lucide-react";
import type { MenuProfileAdmin } from "@/src/types/contracts.public-menu";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                checked ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"
            }`}
        >
            <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    checked ? "translate-x-5" : "translate-x-0"
                }`}
            />
        </button>
    );
}

export default function MenuCardapioSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [slug, setSlug] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [tagline, setTagline] = useState("");
    const [whatsappPhone, setWhatsappPhone] = useState("");
    const [isActive, setIsActive] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showQr, setShowQr] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/menu-profile", { credentials: "include", cache: "no-store" });
            const json = await res.json().catch(() => ({}));
            const profile = json?.profile as MenuProfileAdmin | null;
            if (profile) {
                setSlug(profile.slug);
                setDisplayName(profile.displayName);
                setTagline(profile.tagline ?? "");
                setWhatsappPhone(profile.whatsappPhone ?? "");
                setIsActive(profile.isActive);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const publicPath = slug.trim() ? `/c/${slug.trim().toLowerCase()}` : "";
    const publicUrl =
        typeof globalThis.window !== "undefined" && publicPath
            ? `${globalThis.window.location.origin}${publicPath}`
            : publicPath;

    async function save() {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/menu-profile", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slug,
                    displayName,
                    tagline: tagline || null,
                    whatsappPhone: whatsappPhone || null,
                    isActive,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const errMap: Record<string, string> = {
                    slug_taken: "Este link já está em uso por outra loja.",
                    slug_invalid: "Link inválido. Use letras minúsculas, números e hífens.",
                    slug_too_short: "Link muito curto (mín. 2 caracteres).",
                    display_name_required: "Informe o nome de exibição.",
                };
                setMsg(errMap[String(json?.error)] ?? json?.error ?? "Erro ao salvar");
                return;
            }
            const profile = json.profile as MenuProfileAdmin;
            setSlug(profile.slug);
            setDisplayName(profile.displayName);
            setIsActive(profile.isActive);
            setMsg("✓ Cardápio salvo");
            setTimeout(() => setMsg(null), 4000);
        } finally {
            setSaving(false);
        }
    }

    async function copyLink() {
        if (!publicUrl) return;
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setMsg("Não foi possível copiar. Selecione o link manualmente.");
        }
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-10 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando cardápio…
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                    <Link2 className="h-4 w-4 text-violet-600" />
                    Cardápio web
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                    Link público com fotos e preços. Clientes abrem no navegador sem login.
                </p>
            </div>

            <div className="rounded-xl border border-zinc-100 p-5 dark:border-zinc-800 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Cardápio ativo</p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Desligado = link offline (não lista produtos).
                        </p>
                    </div>
                    <Toggle checked={isActive} onChange={setIsActive} />
                </div>

                <label className="block">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Nome no cardápio</span>
                    <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        placeholder="Disk Bebidas Centro"
                    />
                </label>

                <label className="block">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        Link (slug) — renthus.app/c/
                    </span>
                    <input
                        value={slug}
                        onChange={(e) => setSlug(e.target.value.toLowerCase())}
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        placeholder="disk-bebidas-centro"
                    />
                </label>

                <label className="block">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Frase curta (opcional)</span>
                    <input
                        value={tagline}
                        onChange={(e) => setTagline(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        placeholder="Gelada na porta em minutos"
                    />
                </label>

                <label className="block">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        WhatsApp do pedido (com DDI)
                    </span>
                    <input
                        value={whatsappPhone}
                        onChange={(e) => setWhatsappPhone(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        placeholder="5566999999999"
                    />
                </label>
            </div>

            {publicPath && (
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-800/40 space-y-3">
                    <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Link público</p>
                    <p className="break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700">
                        {publicUrl || publicPath}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => void copyLink()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied ? "Copiado" : "Copiar link"}
                        </button>
                        <a
                            href={publicPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir
                        </a>
                        <button
                            type="button"
                            onClick={() => setShowQr((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                            <QrCode className="h-3.5 w-3.5" />
                            {showQr ? "Ocultar QR" : "QR Code"}
                        </button>
                    </div>
                    {showQr && publicUrl && (
                        <div className="flex justify-center pt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(publicUrl)}`}
                                alt="QR Code do cardápio"
                                width={180}
                                height={180}
                                className="rounded-lg bg-white p-2 ring-1 ring-zinc-200"
                            />
                        </div>
                    )}
                </div>
            )}

            {msg && (
                <div
                    className={`rounded-lg px-3 py-2 text-sm font-medium ${
                        msg.startsWith("✓")
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-400"
                            : "border border-red-200 bg-red-50 text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-400"
                    }`}
                >
                    {msg}
                </div>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    disabled={saving || !displayName.trim()}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar cardápio
                </button>
            </div>
        </div>
    );
}
