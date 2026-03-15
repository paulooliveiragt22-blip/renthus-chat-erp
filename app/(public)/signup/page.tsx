"use client";

/**
 * app/(public)/signup/page.tsx  →  rota: /signup
 *
 * Página pública de contratação.
 * Sem sidebar, sem header (AdminShell e HeaderClient ignoram /signup).
 */

import Image from "next/image";
import { useState, useMemo } from "react";
import CheckoutModal from "@/components/billing/CheckoutModal";

// ---------------------------------------------------------------------------
// Planos
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
        highlight:   true,
        description: "Bot + ERP completo para gestão do negócio",
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

type PlanKey        = "bot" | "complete";
type PaymentMethod  = "pix" | "credit_card";

const PIX_DISCOUNT = 0.05; // 5% de desconto no setup

function fmt(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SignupPage() {
    const [selectedPlan,    setSelectedPlan]    = useState<PlanKey | null>(null);
    const [paymentMethod,   setPaymentMethod]   = useState<PaymentMethod>("pix");
    const [installments,    setInstallments]    = useState(1);
    const [checkoutUrl,     setCheckoutUrl]     = useState<string | null>(null);
    const [successMsg,      setSuccessMsg]      = useState(false);
    const [loading,         setLoading]         = useState(false);
    const [error,           setError]           = useState<string | null>(null);

    const [form, setForm] = useState({
        company_name: "",
        cnpj:         "",
        whatsapp:     "",
        email:        "",
    });

    const plan = selectedPlan ? PLANS.find((p) => p.key === selectedPlan)! : null;

    // Preço do setup considerando desconto PIX
    const setupPrice = useMemo(() => {
        if (!plan) return 0;
        return paymentMethod === "pix"
            ? Math.round(plan.setup * (1 - PIX_DISCOUNT) * 100) / 100
            : plan.setup;
    }, [plan, paymentMethod]);

    const installmentValue = useMemo(
        () => (plan ? setupPrice / installments : 0),
        [setupPrice, installments, plan]
    );

    const resumoText = useMemo(() => {
        if (!plan) return "";
        if (paymentMethod === "pix") {
            return `Setup: ${fmt(setupPrice)} à vista no PIX + ${fmt(plan.monthly)}/mês após 30 dias grátis`;
        }
        return `Setup: ${installments}x de ${fmt(installmentValue)} + ${fmt(plan.monthly)}/mês após 30 dias grátis`;
    }, [plan, paymentMethod, setupPrice, installments, installmentValue]);

    function handleField(key: keyof typeof form, value: string) {
        setForm((f) => ({ ...f, [key]: value }));
        setError(null);
    }

    function selectPlan(key: PlanKey) {
        setSelectedPlan(key);
        setInstallments(1);
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
                    plan:           selectedPlan,
                    payment_method: paymentMethod,
                    installments:   paymentMethod === "credit_card" ? installments : 1,
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
    return (
        <div style={S.page}>

            {/* Logo */}
            <div style={{ marginBottom: 36 }}>
                <Image
                    src="/assets/renthus-logo-white.svg"
                    alt="Renthus"
                    width={140}
                    height={40}
                    style={{ objectFit: "contain" }}
                    priority
                />
            </div>

            {/* Cabeçalho */}
            <div style={{ textAlign: "center", marginBottom: 40 }}>
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
                            onClick={() => selectPlan(p.key)}
                            style={{
                                ...S.planCard,
                                ...(active ? S.planCardActive : S.planCardInactive),
                            }}
                        >
                            {p.highlight && (
                                <div style={{
                                    ...S.badge,
                                    background: active ? "#fff" : "#FF6B00",
                                    color:      active ? "#FF6B00" : "#fff",
                                }}>
                                    Mais popular
                                </div>
                            )}

                            <div style={{ ...S.planName, color: active ? "#fff" : "#111827" }}>
                                {p.name}
                            </div>
                            <div style={{ ...S.planDesc, color: active ? "rgba(255,255,255,0.80)" : "#6b7280" }}>
                                {p.description}
                            </div>

                            <div style={S.planPriceRow}>
                                <span style={{ ...S.planPriceValue, color: active ? "#fff" : "#111827" }}>
                                    {fmt(p.monthly)}
                                </span>
                                <span style={{ ...S.planPricePer, color: active ? "rgba(255,255,255,0.70)" : "#6b7280" }}>
                                    /mês
                                </span>
                            </div>

                            <div style={{ ...S.planSetup, color: active ? "rgba(255,255,255,0.65)" : "#9ca3af" }}>
                                Setup: {fmt(p.setup)}
                            </div>

                            <ul style={S.featureList}>
                                {p.features.map((f) => (
                                    <li key={f} style={{ ...S.featureItem, color: active ? "#fff" : "#374151" }}>
                                        <svg
                                            width="14" height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke={active ? "#fff" : "#22c55e"}
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            style={{ flexShrink: 0 }}
                                        >
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

            {/* Formulário */}
            {plan && (
                <form onSubmit={handleSubmit} style={S.form}>
                    <h2 style={S.formTitle}>Complete sua contratação</h2>

                    {/* Forma de pagamento */}
                    <div style={S.field}>
                        <label style={S.label}>Forma de pagamento do setup</label>
                        <div style={S.payMethodRow}>
                            <button
                                type="button"
                                onClick={() => { setPaymentMethod("pix"); setInstallments(1); }}
                                style={{
                                    ...S.payMethodBtn,
                                    ...(paymentMethod === "pix" ? S.payMethodBtnActive : {}),
                                }}
                            >
                                <span style={{ fontSize: 20 }}>⚡</span>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>PIX</div>
                                    <div style={{ fontSize: 11, color: paymentMethod === "pix" ? "#fff" : "#6b7280" }}>
                                        5% de desconto
                                    </div>
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={() => setPaymentMethod("credit_card")}
                                style={{
                                    ...S.payMethodBtn,
                                    ...(paymentMethod === "credit_card" ? S.payMethodBtnActive : {}),
                                }}
                            >
                                <span style={{ fontSize: 20 }}>💳</span>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>Cartão</div>
                                    <div style={{ fontSize: 11, color: paymentMethod === "credit_card" ? "#fff" : "#6b7280" }}>
                                        em até 10x
                                    </div>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Parcelamento — só aparece para cartão */}
                    {paymentMethod === "credit_card" && (
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
                        </div>
                    )}

                    {/* Resumo do pedido */}
                    <div style={S.resumoBox}>
                        <div style={S.resumoLabel}>Resumo</div>
                        <div style={S.resumoText}>{resumoText}</div>
                        {paymentMethod === "pix" && (
                            <div style={S.descontoBadge}>
                                Você economiza {fmt(plan.setup * PIX_DISCOUNT)} com PIX
                            </div>
                        )}
                    </div>

                    {/* Dados da empresa */}
                    <div style={S.fieldSection}>Dados da empresa</div>

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
                            inputMode="numeric"
                            placeholder="00.000.000/0000-00"
                            value={form.cnpj}
                            onChange={(e) => handleField("cnpj", e.target.value)}
                            required
                        />
                    </div>

                    <div style={{ display: "flex", gap: 14 }}>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>WhatsApp *</label>
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
                                placeholder="contato@empresa.com"
                                value={form.email}
                                onChange={(e) => handleField("email", e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    {error && <div style={S.errorBox}>{error}</div>}

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

            {/* Sucesso pós-checkout */}
            {successMsg && (
                <div style={S.successOverlay}>
                    <div style={S.successCard}>
                        <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
                        <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 800, color: "#111827" }}>
                            Bem-vindo à Renthus!
                        </h2>
                        <p style={{ margin: "0 0 24px", fontSize: 15, color: "#6b7280", lineHeight: 1.7 }}>
                            Pagamento confirmado! Seu trial de 30 dias está ativo.
                            <br />
                            Nossa equipe entrará em contato para configurar seu sistema.
                        </p>
                        <a href="/login" style={S.successBtn}>
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
const S = {
    page: {
        minHeight:     "100vh",
        background:    "linear-gradient(160deg, #1a0030 0%, #2d1060 50%, #0d0018 100%)",
        display:       "flex",
        flexDirection: "column" as const,
        alignItems:    "center",
        padding:       "48px 16px 64px",
        fontFamily:    "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
    title: {
        margin:        "0 0 10px",
        fontSize:      34,
        fontWeight:    800,
        color:         "#ffffff",
        letterSpacing: "-0.5px",
    },
    subtitle: {
        margin:   0,
        fontSize: 15,
        color:    "rgba(255,255,255,0.60)",
    },
    plansRow: {
        display:        "flex",
        gap:            24,
        flexWrap:       "wrap" as const,
        justifyContent: "center",
        width:          "100%",
        maxWidth:       880,
        marginBottom:   36,
    },
    planCard: {
        position:      "relative" as const,
        borderRadius:  18,
        padding:       "32px 28px",
        width:         360,
        textAlign:     "left" as const,
        cursor:        "pointer",
        transition:    "transform 0.15s, box-shadow 0.15s",
        border:        "2px solid transparent",
    },
    planCardActive: {
        background:  "#FF6B00",
        boxShadow:   "0 16px 48px rgba(255,107,0,0.45)",
        transform:   "translateY(-4px)",
        border:      "2px solid #FF6B00",
    },
    planCardInactive: {
        background:  "#ffffff",
        border:      "2px solid rgba(255,107,0,0.25)",
        boxShadow:   "0 4px 24px rgba(0,0,0,0.18)",
    },
    badge: {
        position:      "absolute" as const,
        top:           -13,
        left:          "50%",
        transform:     "translateX(-50%)",
        fontSize:      11,
        fontWeight:    700,
        padding:       "4px 14px",
        borderRadius:  999,
        whiteSpace:    "nowrap" as const,
        letterSpacing: "0.5px",
        textTransform: "uppercase" as const,
    },
    planName: {
        fontSize:     22,
        fontWeight:   800,
        marginBottom: 4,
    },
    planDesc: {
        fontSize:     13,
        marginBottom: 20,
        lineHeight:   1.5,
    },
    planPriceRow: {
        display:     "flex",
        alignItems:  "baseline",
        gap:         4,
        marginBottom: 4,
    },
    planPriceValue: {
        fontSize:   32,
        fontWeight: 800,
    },
    planPricePer: {
        fontSize: 14,
    },
    planSetup: {
        fontSize:     12,
        marginBottom: 20,
    },
    featureList: {
        listStyle:     "none",
        margin:        0,
        padding:       0,
        display:       "flex",
        flexDirection: "column" as const,
        gap:           10,
    },
    featureItem: {
        display:    "flex",
        alignItems: "center",
        gap:        8,
        fontSize:   13,
        fontWeight: 500,
    },
    // Formulário
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
    label: {
        fontSize:   13,
        fontWeight: 600,
        color:      "#374151",
    },
    input: {
        padding:      "11px 14px",
        border:       "1.5px solid #d1d5db",
        borderRadius: 10,
        fontSize:     14,
        color:        "#111827",
        outline:      "none",
        width:        "100%",
        boxSizing:    "border-box" as const,
    },
    select: {
        padding:      "11px 14px",
        border:       "1.5px solid #d1d5db",
        borderRadius: 10,
        fontSize:     14,
        color:        "#111827",
        background:   "#fff",
        cursor:       "pointer",
        width:        "100%",
    },
    // Forma de pagamento
    payMethodRow: {
        display: "flex",
        gap:     12,
    },
    payMethodBtn: {
        flex:          1,
        display:       "flex",
        alignItems:    "center",
        gap:           10,
        padding:       "12px 16px",
        border:        "1.5px solid #d1d5db",
        borderRadius:  12,
        background:    "#f9fafb",
        cursor:        "pointer",
        textAlign:     "left" as const,
        transition:    "all 0.15s",
        color:         "#111827",
    },
    payMethodBtnActive: {
        background:  "#FF6B00",
        border:      "1.5px solid #FF6B00",
        color:       "#fff",
        boxShadow:   "0 4px 14px rgba(255,107,0,0.30)",
    },
    // Resumo
    resumoBox: {
        background:   "#fff7ed",
        border:       "1px solid #fed7aa",
        borderRadius: 12,
        padding:      "14px 16px",
        marginBottom: 20,
    },
    resumoLabel: {
        fontSize:      11,
        fontWeight:    700,
        color:         "#9a3412",
        textTransform: "uppercase" as const,
        letterSpacing: "0.5px",
        marginBottom:  4,
    },
    resumoText: {
        fontSize:   14,
        fontWeight: 600,
        color:      "#7c2d12",
    },
    descontoBadge: {
        marginTop:    8,
        display:      "inline-block",
        background:   "#22c55e",
        color:        "#fff",
        fontSize:     11,
        fontWeight:   700,
        padding:      "3px 10px",
        borderRadius: 999,
    },
    fieldSection: {
        fontSize:      12,
        fontWeight:    700,
        color:         "#9ca3af",
        textTransform: "uppercase" as const,
        letterSpacing: "0.8px",
        marginBottom:  12,
        paddingTop:    4,
        borderTop:     "1px solid #f3f4f6",
        paddingTop2:   4,
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
        background:   "#FF6B00",
        color:        "#fff",
        border:       "none",
        borderRadius: 12,
        fontSize:     16,
        fontWeight:   700,
        cursor:       "pointer",
        boxShadow:    "0 4px 14px rgba(255,107,0,0.40)",
        marginBottom: 12,
    },
    secureNote: {
        margin:    0,
        textAlign: "center" as const,
        fontSize:  12,
        color:     "#9ca3af",
    },
    footer: {
        marginTop: 40,
        fontSize:  12,
        color:     "rgba(255,255,255,0.30)",
    },
    successOverlay: {
        position:       "fixed" as const,
        inset:          0,
        background:     "rgba(0,0,0,0.75)",
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
        maxWidth:      400,
        width:         "100%",
    },
    successBtn: {
        display:        "block",
        padding:        "13px 24px",
        background:     "#FF6B00",
        color:          "#fff",
        borderRadius:   12,
        fontWeight:     700,
        fontSize:       15,
        textDecoration: "none" as const,
    },
};
