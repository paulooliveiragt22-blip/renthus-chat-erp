"use client";

/**
 * app/(public)/signup/page.tsx  →  rota: /signup
 *
 * Cadastro com senha + trial gratuito (TRIAL_DAYS, padrão 15 no servidor).
 * Sem pagamento aqui; após o trial o cron gera fatura PIX. Pagamento libera o sistema
 * sem /signup/complete nem /onboarding.
 */

import Image from "next/image";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const TRIAL_DAYS = process.env.NEXT_PUBLIC_TRIAL_DAYS ?? "15";

const PLANS = [
    {
        key:          "bot" as const,
        name:         "Bot",
        popular:      false,
        description:  "Chatbot de pedidos via WhatsApp automatizado",
        monthlyPrice: 297,
        features: [
            "Bot de pedidos 24h",
            "Cardápio digital",
            "Integração WhatsApp",
            "Relatórios básicos",
        ],
    },
    {
        key:          "complete" as const,
        name:         "Completo",
        popular:      true,
        description:  "Bot + ERP completo para gestão do negócio",
        monthlyPrice: 397,
        features: [
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

function fmt(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function SignupPage() {
    const router = useRouter();
    const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        company_name:      "",
        cnpj:              "",
        whatsapp:          "",
        email:             "",
        password:          "",
        password_confirm:  "",
    });

    const formRef = useRef<HTMLFormElement>(null);

    const plan = selectedPlan ? PLANS.find((p) => p.key === selectedPlan)! : null;

    function selectPlan(key: PlanKey) {
        setSelectedPlan(key);
        setError(null);
        setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
    }

    function handleField<K extends keyof typeof form>(k: K, v: string) {
        setForm((f) => ({ ...f, [k]: v }));
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
                body: JSON.stringify({
                    company_name:     form.company_name,
                    cnpj:             form.cnpj,
                    whatsapp:         form.whatsapp,
                    email:            form.email,
                    plan:             selectedPlan,
                    password:         form.password,
                    password_confirm: form.password_confirm,
                }),
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) {
                setError(data.error ?? "Não foi possível concluir o cadastro.");
                return;
            }
            router.push("/login?cadastro=ok");
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={S.page}>
            <div style={{ marginBottom: 36 }}>
                <Image
                    src="/renthus_logo.png"
                    alt="Renthus"
                    width={148}
                    height={44}
                    style={{ objectFit: "contain" }}
                    priority
                />
            </div>

            <div style={{ textAlign: "center", marginBottom: 32 }}>
                <h1 style={S.title}>Crie sua conta</h1>
                <p style={S.subtitle}>
                    {TRIAL_DAYS} dias de teste completos · depois, pague a mensalidade para continuar
                </p>
            </div>

            <div style={S.plansRow}>
                {PLANS.map((p) => {
                    const active = selectedPlan === p.key;
                    return (
                        <div
                            key={p.key}
                            role="button"
                            tabIndex={0}
                            onClick={() => selectPlan(p.key)}
                            onKeyDown={(e) => e.key === "Enter" && selectPlan(p.key)}
                            style={{
                                ...S.planCard,
                                ...(active ? S.planCardActive : S.planCardInactive),
                            }}
                        >
                            {p.popular && <div style={S.popularBadge}>MAIS POPULAR</div>}
                            <div style={S.planName}>{p.name}</div>
                            <div style={S.planDesc}>{p.description}</div>
                            <div style={{ ...S.priceRow, transition: "opacity 0.25s" }}>
                                <span style={S.priceValue}>{fmt(p.monthlyPrice)}</span>
                                <span style={S.pricePer}>/mês</span>
                            </div>
                            <div style={S.setupLine}>Após o teste · cancele quando quiser</div>
                            <ul style={S.featureList}>
                                {p.features.map((f) => (
                                    <li key={f} style={S.featureItem}>
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="#FF6B00"
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
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    selectPlan(p.key);
                                }}
                                style={{
                                    ...S.planBtn,
                                    ...(active ? S.planBtnActive : S.planBtnInactive),
                                }}
                            >
                                {active ? "Plano selecionado ✓" : "Quero este plano"}
                            </button>
                        </div>
                    );
                })}
            </div>

            {plan && (
                <form ref={formRef} onSubmit={handleSubmit} style={S.form}>
                    <h2 style={S.formTitle}>Dados de acesso</h2>

                    <div style={S.resumoBox}>
                        <div style={S.resumoQuestion}>Como funciona</div>
                        <div style={S.resumoHighlight}>
                            Você usa o sistema grátis por {TRIAL_DAYS} dias (plano {plan.name}).
                        </div>
                        <div style={S.resumoHighlight}>
                            Quando o teste acabar, enviamos a cobrança da mensalidade ({fmt(plan.monthlyPrice)}
                            /mês) por PIX. Ao pagar, o acesso continua normalmente — sem novo cadastro.
                        </div>
                    </div>

                    <div style={S.sectionLabel}>Empresa</div>
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
                            <label style={S.label}>E-mail (login) *</label>
                            <input
                                style={S.input}
                                type="email"
                                placeholder="contato@empresa.com"
                                value={form.email}
                                onChange={(e) => handleField("email", e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <div style={S.sectionLabel}>Senha</div>
                    <div style={S.field}>
                        <label style={S.label}>Senha * (mín. 8 caracteres)</label>
                        <input
                            style={S.input}
                            type="password"
                            value={form.password}
                            onChange={(e) => handleField("password", e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                        />
                    </div>
                    <div style={S.field}>
                        <label style={S.label}>Confirmar senha *</label>
                        <input
                            style={S.input}
                            type="password"
                            value={form.password_confirm}
                            onChange={(e) => handleField("password_confirm", e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                        />
                    </div>

                    {error && <div style={S.errorBox}>{error}</div>}

                    <button type="submit" disabled={loading} style={{ ...S.submitBtn, opacity: loading ? 0.7 : 1 }}>
                        {loading ? "Criando conta…" : "Criar conta e começar o teste →"}
                    </button>
                    <p style={S.secureNote}>
                        Ao continuar, você concorda em usar o sistema nas condições do período de teste e da
                        mensalidade após o vencimento.
                    </p>
                </form>
            )}

            <p style={S.footer}>© {new Date().getFullYear()} Renthus · Todos os direitos reservados</p>
        </div>
    );
}

const S = {
    page: {
        minHeight:     "100vh",
        background:    "#1A123D",
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
        color:    "rgba(255,255,255,0.55)",
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
        padding:       "28px 24px 20px",
        width:         360,
        display:       "flex",
        flexDirection: "column" as const,
        background:    "#fff",
        cursor:        "pointer",
        outline:       "none",
        transition:    "box-shadow 0.15s, border-color 0.15s",
    },
    planCardActive: {
        border:    "2.5px solid #FF6B00",
        boxShadow: "0 8px 32px rgba(255,107,0,0.25)",
    },
    planCardInactive: {
        border:    "2px solid rgba(255,255,255,0.12)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
    },
    popularBadge: {
        position:      "absolute" as const,
        top:           -13,
        left:          "50%",
        transform:     "translateX(-50%)",
        background:    "#FF6B00",
        color:         "#fff",
        fontSize:      10,
        fontWeight:    800,
        padding:       "4px 14px",
        borderRadius:  999,
        letterSpacing: "1px",
        whiteSpace:    "nowrap" as const,
    },
    planName: {
        fontSize:     20,
        fontWeight:   800,
        color:        "#111827",
        marginBottom: 4,
    },
    planDesc: {
        fontSize:     13,
        color:        "#6b7280",
        marginBottom: 18,
        lineHeight:   1.5,
    },
    priceRow: {
        display:      "flex",
        alignItems:   "baseline",
        gap:          4,
        marginBottom: 4,
    },
    priceValue: {
        fontSize:   30,
        fontWeight: 800,
        color:      "#111827",
    },
    pricePer: {
        fontSize: 14,
        color:    "#6b7280",
    },
    setupLine: {
        fontSize:     12,
        color:        "#9ca3af",
        marginBottom: 14,
    },
    featureList: {
        listStyle:     "none",
        margin:        "0 0 20px",
        padding:       0,
        display:       "flex",
        flexDirection: "column" as const,
        gap:           9,
        flex:          1,
    },
    featureItem: {
        display:    "flex",
        alignItems: "center",
        gap:        8,
        fontSize:   13,
        color:      "#374151",
        fontWeight: 500,
    },
    planBtn: {
        width:        "100%",
        padding:      "12px 0",
        border:       "none",
        borderRadius: 10,
        fontSize:     14,
        fontWeight:   700,
        cursor:       "pointer",
        marginTop:    "auto",
        transition:   "all 0.15s",
    },
    planBtnInactive: {
        background: "#FF6B00",
        color:      "#fff",
        boxShadow:  "0 3px 10px rgba(255,107,0,0.30)",
    },
    planBtnActive: {
        background: "#c75200",
        color:      "#fff",
    },
    form: {
        background:      "#fff",
        borderRadius:    20,
        padding:         "32px 28px",
        width:           "100%",
        maxWidth:        560,
        boxShadow:       "0 16px 48px rgba(0,0,0,0.35)",
        scrollMarginTop: 32,
    },
    formTitle: {
        margin:     "0 0 24px",
        fontSize:   18,
        fontWeight: 800,
        color:      "#111827",
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
    resumoBox: {
        background:   "#fff7ed",
        border:       "1px solid #fed7aa",
        borderRadius: 12,
        padding:      "14px 16px",
        marginBottom: 20,
    },
    resumoQuestion: {
        fontSize:     11,
        color:        "#9a6830",
        marginBottom: 6,
        fontWeight:   500,
    },
    resumoHighlight: {
        fontSize:     13,
        fontWeight:   600,
        color:        "#7c2d12",
        lineHeight:   1.6,
        marginBottom: 6,
    },
    sectionLabel: {
        fontSize:      11,
        fontWeight:    700,
        color:         "#9ca3af",
        textTransform: "uppercase" as const,
        letterSpacing: "0.8px",
        marginBottom:  12,
        paddingTop:    16,
        borderTop:     "1px solid #f3f4f6",
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
};
