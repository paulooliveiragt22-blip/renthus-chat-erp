"use client";

/**
 * app/(public)/signup/page.tsx  →  rota: /signup
 *
 * Página pública de contratação.
 * Sem sidebar, sem header (AdminShell e HeaderClient ignoram /signup).
 */

import { useState, useMemo } from "react";
import CheckoutModal from "@/components/billing/CheckoutModal";

// ---------------------------------------------------------------------------
// Configuração de planos (espelha as env vars do backend)
// ---------------------------------------------------------------------------
const PLANS = [
    {
        key:         "bot" as const,
        name:        "Bot",
        monthly:     297,
        setup:       497,
        highlight:   false,
        description: "Chatbot de pedidos via WhatsApp automatizado",
        features:    [
            "Bot de pedidos 24h",
            "Cardápio digital",
            "Integração WhatsApp",
            "Relatórios básicos",
        ],
    },
    {
        key:         "complete" as const,
        name:        "Completo",
        monthly:     397,
        setup:       797,
        description: "Bot + ERP completo para gestão do negócio",
        highlight:   true,
        features:    [
            "Tudo do plano Bot",
            "ERP completo",
            "Gestão de estoque",
            "Impressão automática",
            "Relatórios avançados",
            "Suporte prioritário",
        ],
    },
] as const;

type PlanKey = "bot" | "complete";

function fmt(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SignupPage() {
    const [selectedPlan, setSelectedPlan]     = useState<PlanKey | null>(null);
    const [installments, setInstallments]     = useState(1);
    const [checkoutUrl, setCheckoutUrl]       = useState<string | null>(null);
    const [successMsg, setSuccessMsg]         = useState(false);
    const [loading, setLoading]               = useState(false);
    const [error, setError]                   = useState<string | null>(null);

    const [form, setForm] = useState({
        company_name: "",
        cnpj:         "",
        whatsapp:     "",
        email:        "",
    });

    const plan = selectedPlan ? PLANS.find((p) => p.key === selectedPlan)! : null;

    const installmentValue = useMemo(() => {
        if (!plan) return 0;
        return plan.setup / installments;
    }, [plan, installments]);

    function handleField(key: keyof typeof form, value: string) {
        setForm((f) => ({ ...f, [key]: value }));
        setError(null);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedPlan) return;
        setError(null);
        setLoading(true);

        try {
            const res = await fetch("/api/billing/signup", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    ...form,
                    plan:         selectedPlan,
                    installments,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.checkout_url) {
                setError(data.error ?? "Erro ao gerar link de pagamento.");
                return;
            }

            setCheckoutUrl(data.checkout_url);
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    const S = styles;

    return (
        <div style={S.page}>
            {/* Logo */}
            <div style={S.logoWrap}>
                <img src="/assets/renthus-logo.svg" alt="Renthus" style={S.logo} />
            </div>

            {/* Cabeçalho */}
            <div style={S.header}>
                <h1 style={S.title}>Escolha seu plano</h1>
                <p style={S.subtitle}>
                    30 dias grátis após a ativação · Cancele quando quiser
                </p>
            </div>

            {/* Cards de plano */}
            <div style={S.plansRow}>
                {PLANS.map((p) => {
                    const active = selectedPlan === p.key;
                    return (
                        <button
                            key={p.key}
                            onClick={() => { setSelectedPlan(p.key); setInstallments(1); }}
                            style={{
                                ...S.planCard,
                                ...(active   ? S.planCardActive   : {}),
                                ...(p.highlight && !active ? S.planCardHighlight : {}),
                            }}
                        >
                            {p.highlight && (
                                <div style={S.badge}>Mais popular</div>
                            )}
                            <div style={S.planName}>{p.name}</div>
                            <div style={S.planDesc}>{p.description}</div>

                            <div style={S.planPrice}>
                                <span style={S.planPriceValue}>{fmt(p.monthly)}</span>
                                <span style={S.planPricePer}>/mês</span>
                            </div>
                            <div style={S.planSetup}>
                                Setup: {fmt(p.setup)}
                            </div>

                            <ul style={S.featureList}>
                                {p.features.map((f) => (
                                    <li key={f} style={S.featureItem}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? "#7c3aed" : "#22c55e"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        {f}
                                    </li>
                                ))}
                            </ul>
                        </button>
                    );
                })}
            </div>

            {/* Formulário — só aparece quando plano selecionado */}
            {plan && (
                <form onSubmit={handleSubmit} style={S.form}>
                    <h2 style={S.formTitle}>Dados da empresa</h2>

                    {/* Parcelamento do setup */}
                    <div style={S.field}>
                        <label style={S.label}>Parcelamento do setup ({fmt(plan.setup)})</label>
                        <select
                            value={installments}
                            onChange={(e) => setInstallments(Number(e.target.value))}
                            style={S.select}
                        >
                            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                    {n}x de {fmt(plan.setup / n)}
                                    {n === 1 ? " (à vista)" : ""}
                                </option>
                            ))}
                        </select>
                        <p style={S.resumo}>
                            Resumo: {installments}x de {fmt(installmentValue)} + {fmt(plan.monthly)}/mês após 30 dias grátis
                        </p>
                    </div>

                    {/* Campos */}
                    <div style={S.field}>
                        <label style={S.label}>Nome da empresa *</label>
                        <input
                            style={S.input}
                            type="text"
                            placeholder="Ex: Disk Bebidas Central"
                            value={form.company_name}
                            onChange={(e) => handleField("company_name", e.target.value)}
                            required
                        />
                    </div>

                    <div style={S.field}>
                        <label style={S.label}>CNPJ *</label>
                        <input
                            style={S.input}
                            type="text"
                            placeholder="00.000.000/0000-00"
                            value={form.cnpj}
                            onChange={(e) => handleField("cnpj", e.target.value)}
                            required
                        />
                    </div>

                    <div style={S.fieldsRow}>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>WhatsApp do responsável *</label>
                            <input
                                style={S.input}
                                type="tel"
                                placeholder="(66) 9 9207-1285"
                                value={form.whatsapp}
                                onChange={(e) => handleField("whatsapp", e.target.value)}
                                required
                            />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>E-mail *</label>
                            <input
                                style={S.input}
                                type="email"
                                placeholder="contato@empresa.com.br"
                                value={form.email}
                                onChange={(e) => handleField("email", e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    {error && (
                        <div style={S.errorBox}>{error}</div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        style={{ ...S.submitBtn, opacity: loading ? 0.7 : 1 }}
                    >
                        {loading ? "Gerando link..." : "Contratar agora →"}
                    </button>

                    <p style={S.secureNote}>
                        🔒 Pagamento processado com segurança pelo Pagar.me
                    </p>
                </form>
            )}

            {/* Footer */}
            <p style={S.footer}>
                © {new Date().getFullYear()} Renthus · Todos os direitos reservados
            </p>

            {/* Checkout Modal */}
            {checkoutUrl && !successMsg && (
                <CheckoutModal
                    url={checkoutUrl}
                    onClose={() => setCheckoutUrl(null)}
                    onSuccess={() => {
                        setCheckoutUrl(null);
                        setSuccessMsg(true);
                    }}
                />
            )}

            {/* Mensagem de sucesso pós-checkout */}
            {successMsg && (
                <div
                    onClick={() => {}}
                    style={{
                        position:       "fixed",
                        inset:          0,
                        background:     "rgba(0,0,0,0.70)",
                        display:        "flex",
                        alignItems:     "center",
                        justifyContent: "center",
                        zIndex:         9999,
                        padding:        16,
                    }}
                >
                    <div style={{
                        background:    "#fff",
                        borderRadius:  20,
                        padding:       "48px 40px",
                        textAlign:     "center",
                        maxWidth:      400,
                        width:         "100%",
                    }}>
                        <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
                        <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 800, color: "#111827" }}>
                            Bem-vindo à Renthus!
                        </h2>
                        <p style={{ margin: "0 0 24px", fontSize: 15, color: "#6b7280", lineHeight: 1.7 }}>
                            Pagamento confirmado! Seu trial de 30 dias está ativo.
                            <br />
                            Nossa equipe entrará em contato para configurar seu sistema.
                        </p>
                        <a
                            href="/login"
                            style={{
                                display:      "block",
                                padding:      "13px 24px",
                                background:   "#7c3aed",
                                color:        "#fff",
                                borderRadius: 12,
                                fontWeight:   700,
                                fontSize:     15,
                                textDecoration: "none",
                            }}
                        >
                            Acessar o sistema
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------
const styles = {
    page: {
        minHeight:      "100vh",
        background:     "linear-gradient(160deg, #1a0030 0%, #2d1060 50%, #0d0018 100%)",
        display:        "flex",
        flexDirection:  "column" as const,
        alignItems:     "center",
        padding:        "40px 16px 60px",
        fontFamily:     "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
    logoWrap: {
        marginBottom: 32,
    },
    logo: {
        height: 36,
        width:  "auto",
        filter: "brightness(0) invert(1)",
    },
    header: {
        textAlign: "center" as const,
        marginBottom: 36,
    },
    title: {
        margin:      "0 0 10px",
        fontSize:    32,
        fontWeight:  800,
        color:       "#ffffff",
        letterSpacing: "-0.5px",
    },
    subtitle: {
        margin:   0,
        fontSize: 15,
        color:    "rgba(255,255,255,0.65)",
    },
    plansRow: {
        display:   "flex",
        gap:       20,
        flexWrap:  "wrap" as const,
        justifyContent: "center",
        width:     "100%",
        maxWidth:  860,
        marginBottom: 32,
    },
    planCard: {
        position:      "relative" as const,
        background:    "#ffffff",
        border:        "2px solid transparent",
        borderRadius:  16,
        padding:       "28px 24px",
        width:         340,
        textAlign:     "left" as const,
        cursor:        "pointer",
        transition:    "transform 0.15s, box-shadow 0.15s",
        boxShadow:     "0 4px 20px rgba(0,0,0,0.20)",
    },
    planCardActive: {
        border:     "2px solid #7c3aed",
        boxShadow:  "0 8px 32px rgba(124,58,237,0.35)",
        transform:  "translateY(-2px)",
    },
    planCardHighlight: {
        border:     "2px solid rgba(124,58,237,0.30)",
    },
    badge: {
        position:     "absolute" as const,
        top:          -12,
        left:         "50%",
        transform:    "translateX(-50%)",
        background:   "#7c3aed",
        color:        "#fff",
        fontSize:     11,
        fontWeight:   700,
        padding:      "3px 12px",
        borderRadius: 999,
        whiteSpace:   "nowrap" as const,
        letterSpacing: "0.5px",
        textTransform: "uppercase" as const,
    },
    planName: {
        fontSize:    20,
        fontWeight:  800,
        color:       "#111827",
        marginBottom: 4,
    },
    planDesc: {
        fontSize:    13,
        color:       "#6b7280",
        marginBottom: 16,
        lineHeight:  1.5,
    },
    planPrice: {
        display:    "flex",
        alignItems: "baseline",
        gap:        4,
        marginBottom: 4,
    },
    planPriceValue: {
        fontSize:   28,
        fontWeight: 800,
        color:      "#111827",
    },
    planPricePer: {
        fontSize: 14,
        color:    "#6b7280",
    },
    planSetup: {
        fontSize:     12,
        color:        "#9ca3af",
        marginBottom: 16,
    },
    featureList: {
        listStyle: "none",
        margin:    0,
        padding:   0,
        display:   "flex",
        flexDirection: "column" as const,
        gap:       8,
    },
    featureItem: {
        display:    "flex",
        alignItems: "center",
        gap:        8,
        fontSize:   13,
        color:      "#374151",
    },
    form: {
        background:   "#ffffff",
        borderRadius: 20,
        padding:      "32px 28px",
        width:        "100%",
        maxWidth:     560,
        boxShadow:    "0 16px 48px rgba(0,0,0,0.30)",
    },
    formTitle: {
        margin:       "0 0 24px",
        fontSize:     18,
        fontWeight:   800,
        color:        "#111827",
    },
    field: {
        display:       "flex",
        flexDirection: "column" as const,
        gap:           6,
        marginBottom:  16,
    },
    fieldsRow: {
        display: "flex",
        gap:     16,
    },
    label: {
        fontSize:   13,
        fontWeight: 600,
        color:      "#374151",
    },
    input: {
        padding:      "11px 14px",
        border:       "1px solid #d1d5db",
        borderRadius: 10,
        fontSize:     14,
        color:        "#111827",
        outline:      "none",
        width:        "100%",
        boxSizing:    "border-box" as const,
    },
    select: {
        padding:      "11px 14px",
        border:       "1px solid #d1d5db",
        borderRadius: 10,
        fontSize:     14,
        color:        "#111827",
        outline:      "none",
        background:   "#fff",
        cursor:       "pointer",
    },
    resumo: {
        margin:     0,
        fontSize:   12,
        color:      "#7c3aed",
        fontWeight: 600,
    },
    errorBox: {
        background:   "#fef2f2",
        border:       "1px solid #fecaca",
        borderRadius: 10,
        padding:      "10px 14px",
        fontSize:     13,
        color:        "#b91c1c",
        marginBottom: 16,
    },
    submitBtn: {
        width:        "100%",
        padding:      "15px 20px",
        background:   "#7c3aed",
        color:        "#fff",
        border:       "none",
        borderRadius: 12,
        fontSize:     16,
        fontWeight:   700,
        cursor:       "pointer",
        boxShadow:    "0 4px 14px rgba(124,58,237,0.40)",
        marginBottom: 12,
    },
    secureNote: {
        margin:     0,
        textAlign:  "center" as const,
        fontSize:   12,
        color:      "#9ca3af",
    },
    footer: {
        marginTop: 40,
        fontSize:  12,
        color:     "rgba(255,255,255,0.30)",
    },
};
