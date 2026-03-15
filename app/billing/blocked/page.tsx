"use client";

/**
 * app/billing/blocked/page.tsx
 *
 * Página standalone — empresa bloqueada por inadimplência.
 * Sem sidebar, sem header (AdminShell e HeaderClient ignoram /billing/blocked).
 */

import { useEffect, useState } from "react";
import CheckoutModal from "@/components/billing/CheckoutModal";

type StatusData = {
    company_name: string | null;
    amount:       number | null;
};

const SUPPORT_WA = "https://wa.me/5566992071285";

export default function BillingBlockedPage() {
    const [data, setData]             = useState<StatusData>({ company_name: null, amount: null });
    const [loadingData, setLoadingData] = useState(true);
    const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
    const [loadingCheckout, setLoadingCheckout] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [paid, setPaid]             = useState(false);

    // Busca dados da assinatura
    useEffect(() => {
        fetch("/api/billing/status")
            .then((r) => r.json())
            .then((d) => {
                setData({
                    company_name: d?.pagarme_subscription
                        ? null  // nome virá do badge company
                        : null,
                    amount: d?.pending_invoice?.amount ?? null,
                });
                // Tenta pegar o nome da empresa do campo company_id (fallback ao título)
            })
            .catch(() => {})
            .finally(() => setLoadingData(false));
    }, []);

    async function handlePayClick() {
        setCheckoutError(null);
        setLoadingCheckout(true);
        try {
            const res  = await fetch("/api/billing/create-invoice-checkout", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({}),
            });
            const json = await res.json();
            if (!res.ok || !json.checkout_url) {
                setCheckoutError(json.error ?? "Erro ao gerar link de pagamento.");
                return;
            }
            setCheckoutUrl(json.checkout_url);
        } catch {
            setCheckoutError("Erro de conexão. Tente novamente.");
        } finally {
            setLoadingCheckout(false);
        }
    }

    const amountFormatted = data.amount != null
        ? data.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : null;

    return (
        <div style={S.page}>
            {/* Logo */}
            <div style={{ marginBottom: 36 }}>
                <img
                    src="/assets/renthus-logo.svg"
                    alt="Renthus"
                    style={{ height: 40, width: "auto", filter: "brightness(0) invert(1)" }}
                />
            </div>

            {/* Card */}
            <div style={S.card}>

                {/* Ícone cadeado */}
                <div style={S.iconWrap}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>

                <h1 style={S.title}>Acesso suspenso</h1>
                <p style={S.subtitle}>
                    Sua mensalidade está em aberto.
                    <br />
                    Regularize para reativar o sistema imediatamente.
                </p>

                {/* Valor pendente */}
                {!loadingData && amountFormatted && (
                    <div style={S.amountBox}>
                        <p style={S.amountLabel}>Valor pendente</p>
                        <p style={S.amountValue}>{amountFormatted}</p>
                    </div>
                )}

                {/* Erro checkout */}
                {checkoutError && (
                    <div style={S.errorBox}>{checkoutError}</div>
                )}

                {/* Botões */}
                <div style={S.buttons}>
                    <button
                        onClick={handlePayClick}
                        disabled={loadingCheckout}
                        style={{ ...S.btnPay, opacity: loadingCheckout ? 0.7 : 1 }}
                    >
                        {loadingCheckout ? "Aguarde..." : "Pagar mensalidade"}
                    </button>

                    <a href={SUPPORT_WA} target="_blank" rel="noopener noreferrer" style={S.btnSupport}>
                        Falar com suporte
                    </a>
                </div>

                <div style={S.separator} />
                <p style={S.note}>
                    Após o pagamento confirmado, o sistema é reativado
                    automaticamente em até 5 minutos.
                </p>
            </div>

            <p style={S.footer}>
                © {new Date().getFullYear()} Renthus — Todos os direitos reservados
            </p>

            {/* Checkout Modal */}
            {checkoutUrl && !paid && (
                <CheckoutModal
                    url={checkoutUrl}
                    onClose={() => setCheckoutUrl(null)}
                    onSuccess={() => {
                        setCheckoutUrl(null);
                        setPaid(true);
                    }}
                />
            )}

            {/* Tela de sucesso */}
            {paid && (
                <div style={S.successOverlay}>
                    <div style={S.successCard}>
                        <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
                        <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 800, color: "#111827" }}>
                            Pagamento confirmado!
                        </h2>
                        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>
                            Seu sistema está sendo reativado.
                            <br />
                            Isso pode levar até 5 minutos.
                        </p>
                        <button
                            onClick={() => window.location.href = "/"}
                            style={S.btnReload}
                        >
                            Acessar o sistema
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------
const S = {
    page: {
        minHeight:       "100vh",
        background:      "linear-gradient(160deg, #1a0030 0%, #0d0018 100%)",
        display:         "flex",
        flexDirection:   "column" as const,
        alignItems:      "center",
        justifyContent:  "center",
        padding:         "24px 16px",
        fontFamily:      "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
    card: {
        background:    "#ffffff",
        borderRadius:  20,
        boxShadow:     "0 24px 64px rgba(0,0,0,0.40)",
        padding:       "40px 36px",
        maxWidth:      440,
        width:         "100%",
        textAlign:     "center" as const,
    },
    iconWrap: {
        width:          72,
        height:         72,
        borderRadius:   "50%",
        background:     "#fef2f2",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        margin:         "0 auto 24px",
    },
    title: {
        margin:        "0 0 10px",
        fontSize:      26,
        fontWeight:    800,
        color:         "#111827",
        letterSpacing: "-0.5px",
    },
    subtitle: {
        margin:       "0 0 20px",
        fontSize:     15,
        color:        "#6b7280",
        lineHeight:   1.6,
    },
    amountBox: {
        background:    "#fef2f2",
        border:        "1px solid #fecaca",
        borderRadius:  12,
        padding:       "14px 18px",
        marginBottom:  24,
    },
    amountLabel: {
        margin:        "0 0 2px",
        fontSize:      12,
        color:         "#b91c1c",
        fontWeight:    600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.5px",
    },
    amountValue: {
        margin:     0,
        fontSize:   28,
        fontWeight: 800,
        color:      "#991b1b",
    },
    errorBox: {
        background:    "#fef2f2",
        border:        "1px solid #fecaca",
        borderRadius:  10,
        padding:       "10px 14px",
        fontSize:      13,
        color:         "#b91c1c",
        marginBottom:  16,
        textAlign:     "left" as const,
    },
    buttons: {
        display:        "flex",
        flexDirection:  "column" as const,
        gap:            12,
        marginBottom:   28,
    },
    btnPay: {
        display:      "block",
        width:        "100%",
        padding:      "14px 20px",
        background:   "#22c55e",
        color:        "#fff",
        border:       "none",
        borderRadius: 12,
        fontWeight:   700,
        fontSize:     16,
        cursor:       "pointer",
        boxShadow:    "0 4px 14px rgba(34,197,94,0.35)",
    },
    btnSupport: {
        display:        "block",
        padding:        "13px 20px",
        background:     "transparent",
        color:          "#7c3aed",
        border:         "2px solid #7c3aed",
        borderRadius:   12,
        fontWeight:     700,
        fontSize:       15,
        textDecoration: "none" as const,
    },
    separator: {
        borderTop:    "1px solid #f3f4f6",
        paddingTop:   20,
    },
    note: {
        margin:     0,
        fontSize:   12,
        color:      "#9ca3af",
        lineHeight: 1.6,
    },
    footer: {
        marginTop: 28,
        fontSize:  12,
        color:     "rgba(255,255,255,0.35)",
    },
    successOverlay: {
        position:       "fixed" as const,
        inset:          0,
        background:     "rgba(0,0,0,0.70)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         9999,
        padding:        16,
    },
    successCard: {
        background:    "#fff",
        borderRadius:  20,
        padding:       "48px 40px",
        textAlign:     "center" as const,
        maxWidth:      380,
        width:         "100%",
    },
    btnReload: {
        display:      "block",
        width:        "100%",
        padding:      "13px 20px",
        background:   "#7c3aed",
        color:        "#fff",
        border:       "none",
        borderRadius: 12,
        fontWeight:   700,
        fontSize:     15,
        cursor:       "pointer",
    },
};
