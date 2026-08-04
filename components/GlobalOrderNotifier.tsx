"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { playBeep, unlockOrderAlertAudio } from "@/lib/utils/playBeep";

type SnapshotOrder = {
    id: string;
    createdAt: string;
    source: string | null;
    totalAmount: number;
};

function sourceLabel(source: string | null): string {
    if (source === "web_menu") return "Cardápio web";
    if (source === "flow_catalog" || source === "flow_checkout") return "WhatsApp Flow";
    if (source === "ai_chat_pro_v2" || source === "chatbot") return "WhatsApp";
    if (source === "marketplace_ifood") return "iFood";
    if (source === "marketplace_aiqfome") return "Aiqfome";
    if (source === "pdv_direct") return "PDV";
    if (source === "ui") return "Painel";
    return "Novo pedido";
}

function orderCode(id: string): string {
    return `#${id.replaceAll("-", "").slice(-6).toUpperCase()}`;
}

/**
 * Escuta pedidos novos da empresa (polling confiável) e toca alerta sonoro
 * em qualquer tela do admin. Realtime Supabase fica como complemento opcional.
 */
export function GlobalOrderNotifier() {
    const { currentCompanyId: companyId, loading } = useWorkspace();
    const seenIdsRef = useRef<Set<string> | null>(null);
    const readyRef = useRef(false);

    // Desbloqueia AudioContext no primeiro clique/tecla (política do browser)
    useEffect(() => {
        const unlock = () => unlockOrderAlertAudio();
        window.addEventListener("pointerdown", unlock, { once: false, passive: true });
        window.addEventListener("keydown", unlock, { once: false, passive: true });
        return () => {
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
        };
    }, []);

    useEffect(() => {
        if (loading || !companyId) return;

        seenIdsRef.current = null;
        readyRef.current = false;
        let cancelled = false;

        async function poll() {
            if (cancelled) return;
            try {
                const res = await fetch("/api/admin/orders/notify-snapshot", {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!res.ok || cancelled) return;
                const json = (await res.json()) as {
                    ids?: string[];
                    orders?: SnapshotOrder[];
                };
                const orders = json.orders ?? [];
                const ids = new Set(orders.map((o) => o.id));

                if (seenIdsRef.current == null) {
                    // Primeiro snapshot: só memoriza (não toca ao abrir o painel)
                    seenIdsRef.current = ids;
                    readyRef.current = true;
                    return;
                }

                if (!readyRef.current) return;

                const newcomers = orders.filter((o) => !seenIdsRef.current!.has(o.id));
                // Atualiza seen com todos os ids atuais + mantém os antigos recentes
                for (const id of ids) seenIdsRef.current.add(id);
                // Evita crescimento infinito
                if (seenIdsRef.current.size > 200) {
                    seenIdsRef.current = new Set(ids);
                }

                if (newcomers.length === 0) return;

                unlockOrderAlertAudio();
                playBeep();
                // Reforço: segundo toque se vários pedidos
                if (newcomers.length > 1) {
                    window.setTimeout(() => playBeep(), 700);
                }

                const first = newcomers[0]!;
                const total = first.totalAmount.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                });
                toast.message(`Pedido ${orderCode(first.id)}`, {
                    description:
                        newcomers.length === 1
                            ? `${sourceLabel(first.source)} · ${total}`
                            : `${newcomers.length} pedidos novos · último ${sourceLabel(first.source)}`,
                    duration: 8000,
                });
            } catch {
                /* ignore transient */
            }
        }

        void poll();
        const timer = window.setInterval(() => void poll(), 5000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [companyId, loading]);

    return null;
}
