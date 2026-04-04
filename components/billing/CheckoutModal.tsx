"use client";

/**
 * Modal que envia o usuário ao checkout hosted do Pagar.me na **mesma aba**.
 *
 * Não use iframe: o reCAPTCHA do Google costuma aparecer como requisição "cancelada"
 * e falhar em contexto embutido (terceiros / cookies).
 */

import { useEffect } from "react";

type Props = {
    url:     string;
    onClose: () => void;
};

export default function CheckoutModal({ url, onClose }: Props) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div
            style={{
                position:       "fixed",
                inset:          0,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                zIndex:         9999,
                padding:        16,
            }}
        >
            <button
                type="button"
                aria-label="Fechar modal"
                onClick={onClose}
                style={{
                    position:   "absolute",
                    inset:      0,
                    border:     "none",
                    padding:    0,
                    background: "rgba(0,0,0,0.70)",
                    cursor:     "default",
                }}
            />
            <div
                role="dialog"
                aria-modal="true"
                style={{
                    position:      "relative",
                    zIndex:        1,
                    width:         "100%",
                    maxWidth:      420,
                    background:    "#ffffff",
                    borderRadius:  16,
                    overflow:      "hidden",
                    boxShadow:     "0 32px 80px rgba(0,0,0,0.45)",
                    padding:       "28px 24px 24px",
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
            </div>
        </div>
    );
}
