"use client";

import { buildWaMeOrdersUrl } from "@/lib/public-menu/waMeIdentity";
import { detectMenuChannelHint } from "@/lib/public-menu/clientMenuSession";

type Props = {
    whatsappPhone: string | null;
    /** Título curto da seção (ex.: Meus pedidos / Checkout). */
    title?: string;
    /** Texto extra abaixo do título. */
    hint?: string;
};

/**
 * Fallback quando não há cookie/`wm` — identidade só via canal (WA ou Direct).
 * Nunca pede telefone digitado.
 */
export default function MenuIdentityFallback({
    whatsappPhone,
    title = "Identifique-se",
    hint,
}: Props) {
    const channelHint = detectMenuChannelHint();
    const waUrl = channelHint !== "instagram" && channelHint !== "messenger"
        ? buildWaMeOrdersUrl(whatsappPhone ?? "")
        : null;

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
            <p className="text-sm leading-relaxed text-zinc-600">
                {hint ??
                    "Para ver pedidos e endereços, usamos o mesmo canal em que você fala com a loja — não pedimos que digite o telefone de outra pessoa."}
            </p>

            {channelHint === "instagram" || channelHint === "messenger" ? (
                <div className="rounded-xl bg-white px-4 py-4 text-sm text-zinc-700 ring-1 ring-zinc-200">
                    <p className="font-medium text-zinc-900">Volte ao chat da loja</p>
                    <p className="mt-2 leading-relaxed">
                        Abra o {channelHint === "instagram" ? "Direct do Instagram" : "Messenger"}{" "}
                        onde você conversa com a loja, toque em <strong>Meus pedidos</strong> e abra o
                        link que o assistente enviar.
                    </p>
                </div>
            ) : waUrl ? (
                <div className="space-y-3 rounded-xl bg-white px-4 py-4 ring-1 ring-zinc-200">
                    <p className="text-sm font-medium text-zinc-900">Pelo WhatsApp da loja</p>
                    <ol className="list-decimal space-y-2 pl-4 text-sm text-zinc-600">
                        <li>Toque no botão abaixo e <strong>envie a mensagem pronta</strong>.</li>
                        <li>Aguarde o link &quot;Meus pedidos&quot; na conversa.</li>
                        <li>Abra esse link — não use esta aba antiga.</li>
                    </ol>
                    <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center rounded-lg bg-[#25D366] py-3 text-sm font-semibold text-white"
                    >
                        Abrir WhatsApp da loja
                    </a>
                </div>
            ) : (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
                    WhatsApp da loja não está configurado. Peça um link pelo chat ou fale com a
                    loja.
                </div>
            )}
        </section>
    );
}
