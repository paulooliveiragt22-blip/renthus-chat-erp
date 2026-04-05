"use client";

/**
 * Modal que envia o usuário ao checkout hosted do Pagar.me na **mesma aba**.
 *
 * Não use iframe: o reCAPTCHA do Google costuma aparecer como requisição "cancelada"
 * e falhar em contexto embutido (terceiros / cookies).
 */

import { useEffect, useRef } from "react";

type Props = Readonly<{
    url:     string;
    onClose: () => void;
}>;

export default function CheckoutModal({ url, onClose }: Props) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (!el.open) el.showModal();
        return () => el.close();
    }, []);

    return (
        <dialog
            ref={ref}
            className="fixed left-1/2 top-1/2 z-[9999] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-0 bg-white p-7 shadow-[0_32px_80px_rgba(0,0,0,0.45)] backdrop:bg-black/70"
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <button
                type="button"
                onClick={onClose}
                style={{
                    position:     "absolute",
                    top:          12,
                    right:        12,
                    width:        32,
                    height:       32,
                    borderRadius: "50%",
                    border:       "none",
                    background:   "#f3f4f6",
                    cursor:       "pointer",
                    fontSize:     18,
                    color:        "#6b7280",
                    lineHeight:   1,
                }}
                title="Fechar"
            >
                ×
            </button>
            <h2 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: "#111827" }}>
                Continuar no Pagar.me
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280", lineHeight: 1.55 }}>
                O pagamento seguro abre no site do Pagar.me (não dentro desta janela embutida), para o
                reCAPTCHA e o cartão funcionarem corretamente.
            </p>
            <button
                type="button"
                onClick={() => {
                    const w = window.open(url, "_blank", "noopener,noreferrer");
                    if (!w) window.location.assign(url);
                }}
                style={{
                    display:      "block",
                    width:        "100%",
                    padding:      "14px 20px",
                    background:   "#22c55e",
                    color:        "#fff",
                    border:       "none",
                    borderRadius: 10,
                    fontWeight:   700,
                    fontSize:     15,
                    cursor:       "pointer",
                }}
            >
                Ir para o pagamento
            </button>
            <button
                type="button"
                onClick={onClose}
                style={{
                    display:      "block",
                    width:        "100%",
                    marginTop:    10,
                    padding:      "12px 20px",
                    background:   "transparent",
                    color:        "#6b7280",
                    border:       "none",
                    fontSize:     14,
                    cursor:       "pointer",
                }}
            >
                Cancelar
            </button>
        </dialog>
    );
}
