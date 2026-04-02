"use client";

/**
 * Retorno do Pagar.me Checkout Hosted (success_url em create-invoice-checkout).
 */

import Link from "next/link";

export default function BillingCheckoutSuccessPage() {
    return (
        <div style={S.page}>
            <div style={S.card}>
                <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
                <h1 style={S.title}>Pagamento recebido</h1>
                <p style={S.text}>
                    Obrigado. Seu pagamento foi enviado ao Pagar.me; a confirmação pode levar alguns
                    instantes. O acesso ao sistema é reativado automaticamente em até alguns minutos.
                </p>
                <Link href="/" style={S.btn}>
                    Acessar o sistema
                </Link>
            </div>
        </div>
    );
}

const S = {
    page: {
        minHeight:      "100vh",
        background:     "linear-gradient(160deg, #1a0030 0%, #0d0018 100%)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        padding:        "24px 16px",
        fontFamily:     "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
    card: {
        background:   "#ffffff",
        borderRadius: 20,
        boxShadow:    "0 24px 64px rgba(0,0,0,0.40)",
        padding:      "40px 36px",
        maxWidth:     440,
        width:        "100%",
        textAlign:    "center" as const,
    },
    title: {
        margin:       "0 0 12px",
        fontSize:     22,
        fontWeight:   800,
        color:        "#111827",
    },
    text: {
        margin:       "0 0 28px",
        fontSize:     15,
        color:        "#6b7280",
        lineHeight:   1.6,
    },
    btn: {
        display:        "inline-block",
        width:          "100%",
        padding:        "14px 20px",
        background:     "#22c55e",
        color:          "#fff",
        borderRadius:   12,
        fontWeight:     700,
        fontSize:       16,
        textDecoration: "none" as const,
        boxSizing:      "border-box" as const,
    },
};
