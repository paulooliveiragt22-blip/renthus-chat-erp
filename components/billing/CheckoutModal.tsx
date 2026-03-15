"use client";

/**
 * components/billing/CheckoutModal.tsx
 *
 * Modal com iframe para o Pagar.me Checkout Hosted.
 *
 * Props:
 *   url       — URL do checkout do Pagar.me
 *   onClose   — chamado quando o usuário fecha o modal
 *   onSuccess — chamado quando o pagamento é confirmado
 */

import { useEffect, useRef, useState } from "react";

type Props = {
    url:       string;
    onClose:   () => void;
    onSuccess: () => void;
};

export default function CheckoutModal({ url, onClose, onSuccess }: Props) {
    const [confirmed, setConfirmed] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Escuta postMessage do Pagar.me para detectar pagamento confirmado
    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            // Aceita mensagens de qualquer origem do Pagar.me
            const data = event.data;
            if (!data) return;

            const type: string =
                typeof data === "string"
                    ? data
                    : (data.type ?? data.event ?? data.name ?? "");

            // Formatos documentados e observados do Pagar.me checkout
            const successTypes = [
                "CHECKOUT.PAYMENT_COMPLETED",
                "PAGARME_CHECKOUT_SUCCESS",
                "CHECKOUT.CLOSE",    // alguns casos de sucesso fecham com este evento
                "payment.success",
                "paid",
                "PAID",
            ];

            const isPaid =
                successTypes.some((t) => type.includes(t)) ||
                data?.payload?.status === "paid"             ||
                data?.status           === "paid"            ||
                data?.order_status     === "paid";

            if (isPaid) {
                setConfirmed(true);
                onSuccess();
            }
        }

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [onSuccess]);

    // Detecta redirecionamento para a success_url dentro do iframe
    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        function handleLoad() {
            try {
                const href = iframe?.contentWindow?.location?.href ?? "";
                if (href.includes("checkout-success") || href.includes("success")) {
                    setConfirmed(true);
                    onSuccess();
                }
            } catch {
                // cross-origin: não conseguimos acessar location — normal
            }
        }

        iframe.addEventListener("load", handleLoad);
        return () => iframe.removeEventListener("load", handleLoad);
    }, [onSuccess]);

    // Fecha ao pressionar ESC
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div
            onClick={onClose}
            style={{
                position:        "fixed",
                inset:           0,
                background:      "rgba(0,0,0,0.70)",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                zIndex:          9999,
                padding:         16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    position:     "relative",
                    width:        480,
                    height:       confirmed ? "auto" : 700,
                    maxWidth:     "100%",
                    maxHeight:    "95vh",
                    background:   "#ffffff",
                    borderRadius: 16,
                    overflow:     "hidden",
                    boxShadow:    "0 32px 80px rgba(0,0,0,0.45)",
                    display:      "flex",
                    flexDirection: "column",
                }}
            >
                {/* Barra superior com botão fechar */}
                <div
                    style={{
                        display:         "flex",
                        alignItems:      "center",
                        justifyContent:  "space-between",
                        padding:         "12px 16px",
                        borderBottom:    "1px solid #f3f4f6",
                        flexShrink:      0,
                    }}
                >
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>
                        Pagamento seguro · Pagar.me
                    </span>
                    <button
                        onClick={onClose}
                        style={{
                            width:        32,
                            height:       32,
                            borderRadius: "50%",
                            border:       "none",
                            background:   "#f3f4f6",
                            cursor:       "pointer",
                            display:      "flex",
                            alignItems:   "center",
                            justifyContent: "center",
                            fontSize:     18,
                            color:        "#6b7280",
                            lineHeight:   1,
                        }}
                        title="Fechar"
                    >
                        ×
                    </button>
                </div>

                {/* Conteúdo */}
                {confirmed ? (
                    // Tela de sucesso
                    <div
                        style={{
                            display:        "flex",
                            flexDirection:  "column",
                            alignItems:     "center",
                            justifyContent: "center",
                            padding:        "48px 32px",
                            gap:            16,
                            textAlign:      "center",
                        }}
                    >
                        <div
                            style={{
                                width:        72,
                                height:       72,
                                borderRadius: "50%",
                                background:   "#dcfce7",
                                display:      "flex",
                                alignItems:   "center",
                                justifyContent: "center",
                            }}
                        >
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#111827" }}>
                            Pagamento confirmado!
                        </h2>
                        <p style={{ margin: 0, fontSize: 15, color: "#6b7280", lineHeight: 1.6 }}>
                            Seu sistema será ativado em instantes.
                        </p>
                        <button
                            onClick={onClose}
                            style={{
                                marginTop:    8,
                                padding:      "12px 28px",
                                background:   "#22c55e",
                                color:        "#fff",
                                border:       "none",
                                borderRadius: 10,
                                fontWeight:   700,
                                fontSize:     15,
                                cursor:       "pointer",
                            }}
                        >
                            Continuar
                        </button>
                    </div>
                ) : (
                    // iframe do checkout
                    <iframe
                        ref={iframeRef}
                        src={url}
                        style={{
                            flex:   1,
                            width:  "100%",
                            border: "none",
                        }}
                        allow="payment"
                        title="Checkout Pagar.me"
                    />
                )}
            </div>
        </div>
    );
}
