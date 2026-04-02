"use client";

/**
 * app/billing/blocked/page.tsx
 *
 * Página standalone — empresa bloqueada por inadimplência.
 * Sem sidebar, sem header (AdminShell e HeaderClient ignoram /billing/blocked).
 */

import { useEffect, useState } from "react";

type StatusData = {
    company_name: string | null;
    amount:       number | null;
};

const SUPPORT_WA = "https://wa.me/5566992071285";

export default function BillingBlockedPage() {
    const [data, setData]             = useState<StatusData>({ company_name: null, amount: null });
    const [loadingData, setLoadingData] = useState(true);
    const [loadingCheckout, setLoadingCheckout] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [pix, setPix] = useState<{ url: string | null; code: string | null } | null>(null);
    const [copied, setCopied] = useState(false);

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
        setCopied(false);
        setLoadingCheckout(true);
        try {
            const res  = await fetch("/api/billing/create-invoice-checkout", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({}),
            });
            const json = await res.json();
            if (!res.ok) {
                setCheckoutError(json.error ?? "Erro ao gerar PIX.");
                return;
            }
            if (json.pix_qr_code || json.pix_qr_url) {
                setPix({
                    url:  json.pix_qr_url ?? null,
                    code: json.pix_qr_code ?? null,
                });
                return;
            }
            setCheckoutError("Não foi possível obter o código PIX.");
        } catch {
            setCheckoutError("Erro de conexão. Tente novamente.");
        } finally {
            setLoadingCheckout(false);
        }
    }

    async function copyPixCode() {
        if (!pix?.code) return;
        try {
            await navigator.clipboard.writeText(pix.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            setCheckoutError("Não foi possível copiar. Selecione o código manualmente.");
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
                    O PIX é gerado aqui mesmo, sem página externa do Pagar.me. Depois do pagamento, o
                    acesso reativa em alguns minutos.
                </p>
            </div>

            <p style={S.footer}>
                © {new Date().getFullYear()} Renthus — Todos os direitos reservados
            </p>

            {pix && (
                <div style={S.pixOverlay} role="dialog" aria-modal="true" aria-labelledby="pix-title">
                    <div style={S.pixCard}>
                        <h2 id="pix-title" style={S.pixTitle}>
                            Pagar com PIX
                        </h2>
                        <p style={S.pixHint}>
                            Escaneie o QR no app do banco ou copie o código. Não fechamos esta janela
                            até você concluir.
                        </p>
                        {pix.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={pix.url} alt="QR Code PIX" style={S.pixQr} />
                        ) : null}
                        {pix.code ? (
                            <>
                                <label style={S.pixLabel}>Pix copia e cola</label>
                                <textarea
                                    readOnly
                                    value={pix.code}
                                    rows={5}
                                    style={S.pixTextarea}
                                    onFocus={(e) => e.target.select()}
                                />
                                <button type="button" onClick={copyPixCode} style={S.pixCopyBtn}>
                                    {copied ? "Copiado!" : "Copiar código"}
                                </button>
                            </>
                        ) : (
                            <p style={S.pixHint}>Código PIX indisponível — tente gerar de novo.</p>
                        )}
                        <button type="button" onClick={() => setPix(null)} style={S.pixCloseBtn}>
                            Fechar
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
    pixOverlay: {
        position:       "fixed" as const,
        inset:          0,
        background:     "rgba(0,0,0,0.75)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         10000,
        padding:        16,
    },
    pixCard: {
        background:   "#fff",
        borderRadius: 20,
        padding:      "28px 22px 22px",
        maxWidth:     400,
        width:        "100%",
        maxHeight:    "90vh",
        overflow:     "auto" as const,
        textAlign:    "center" as const,
    },
    pixTitle: {
        margin:     "0 0 8px",
        fontSize:   20,
        fontWeight: 800,
        color:      "#111827",
    },
    pixHint: {
        margin:     "0 0 16px",
        fontSize:   13,
        color:      "#6b7280",
        lineHeight: 1.5,
    },
    pixQr: {
        display:   "block",
        width:     220,
        height:    220,
        margin:    "0 auto 16px",
        objectFit: "contain" as const,
    },
    pixLabel: {
        display:   "block",
        textAlign: "left" as const,
        fontSize:  12,
        fontWeight: 600,
        color:     "#374151",
        marginBottom: 6,
    },
    pixTextarea: {
        width:        "100%",
        boxSizing:    "border-box" as const,
        fontSize:     11,
        fontFamily:   "ui-monospace, monospace",
        padding:      10,
        borderRadius: 8,
        border:       "1px solid #e5e7eb",
        resize:       "vertical" as const,
        marginBottom: 10,
    },
    pixCopyBtn: {
        display:      "block",
        width:        "100%",
        padding:      "12px 16px",
        background:   "#7c3aed",
        color:        "#fff",
        border:       "none",
        borderRadius: 10,
        fontWeight:   700,
        fontSize:     15,
        cursor:       "pointer",
        marginBottom: 10,
    },
    pixCloseBtn: {
        display:      "block",
        width:        "100%",
        padding:      "10px 16px",
        background:   "transparent",
        color:        "#6b7280",
        border:       "none",
        fontSize:     14,
        cursor:       "pointer",
    },
};
