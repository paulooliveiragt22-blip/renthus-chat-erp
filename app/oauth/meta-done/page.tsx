"use client";

import { useEffect } from "react";

export type MetaOAuthDoneMessage = {
    type: "renthus-meta-oauth";
    oauth: string | null;
    msg: string | null;
};

/**
 * Destino leve do callback OAuth Meta quando aberto em popup:
 * avisa a aba pai e fecha. Sem popup, redireciona para Configurações → Canais.
 */
export default function MetaOAuthDonePage() {
    useEffect(() => {
        const q = new URLSearchParams(window.location.search);
        const payload: MetaOAuthDoneMessage = {
            type: "renthus-meta-oauth",
            oauth: q.get("meta_oauth"),
            msg: q.get("meta_oauth_msg"),
        };

        if (window.opener && !window.opener.closed) {
            try {
                window.opener.postMessage(payload, window.location.origin);
            } catch {
                /* ignore cross-origin */
            }
            window.close();
            return;
        }

        const u = new URL("/configuracoes", window.location.origin);
        u.searchParams.set("tab", "canais");
        if (payload.oauth) u.searchParams.set("meta_oauth", payload.oauth);
        if (payload.msg) u.searchParams.set("meta_oauth_msg", payload.msg);
        window.location.replace(u.toString());
    }, []);

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-sm text-zinc-600">
            Concluindo conexão com o Facebook…
        </main>
    );
}
