"use client";

/**
 * app/(public)/signup/page.tsx  →  rota: /signup
 */

import Image from "next/image";
import { useState, useMemo, useRef } from "react";

// ---------------------------------------------------------------------------
// Dados de planos
// ---------------------------------------------------------------------------
const PLANS = [
    {
        key:          "bot" as const,
        name:         "Bot",
        popular:      false,
        description:  "Chatbot de pedidos via WhatsApp automatizado",
        monthly:      { price: 297, annual: 0,    setup: 497 },
        yearly:       { price: 237, annual: 2844, setup: 0   },
        // (297 - 237) × 12 + 497 = 720 + 497
        yearlySavings: 1217,
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
        monthly:      { price: 397, annual: 0,    setup: 797 },
        yearly:       { price: 317, annual: 3804, setup: 0   },
        // (397 - 317) × 12 + 797 = 960 + 797
        yearlySavings: 1757,
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

type PlanKey       = "bot" | "complete";
type Interval      = "monthly" | "yearly";
type PaymentMethod = "pix" | "credit_card";

const PIX_DISCOUNT = 0.05;

/** Chave pública (pk_test_ / pk_live_) — cadastre o domínio no painel Pagar.me */
const PAGARME_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY ?? "";

function parseCardExpiry(raw: string): { month: string; year: string } | null {
    const s = raw.replace(/\s/g, "");
    const m = s.match(/^(\d{2})\/(\d{2,4})$/);
    if (!m) return null;
    let y = m[2];
    if (y.length === 4) y = y.slice(-2);
    return { month: m[1], year: y };
}

async function pagarmeCreateCardToken(
    publicKey: string,
    p: {
        number: string;
        holder_name: string;
        exp_month: string;
        exp_year: string;
        cvv: string;
        holder_document?: string;
    }
): Promise<string> {
    const res = await fetch(
        `https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`,
        {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                type: "card",
                card: {
                    number:      p.number.replace(/\D/g, ""),
                    holder_name: p.holder_name.replace(/[^a-zA-ZÀ-ÿ\s]/g, "").trim() || p.holder_name.trim(),
                    exp_month:   p.exp_month,
                    exp_year:    p.exp_year,
                    cvv:         p.cvv.replace(/\D/g, ""),
                    ...(p.holder_document && { holder_document: p.holder_document }),
                },
            }),
        }
    );
    const data = (await res.json()) as { message?: string; id?: string };
    if (!res.ok) {
        throw new Error(
            typeof data?.message === "string" ? data.message : "Não foi possível validar o cartão."
        );
    }
    if (!data?.id) throw new Error("Resposta inválida do Pagar.me.");
    return data.id;
}

function fmt(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SignupPage() {
    const [interval,      setIntervalMode] = useState<Interval>("monthly");
    const [selectedPlan,  setSelectedPlan] = useState<PlanKey | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
    const [installments,  setInstallments] = useState(1);
    const [loading,       setLoading]      = useState(false);
    const [error,         setError]        = useState<string | null>(null);
    const [form, setForm] = useState({
        company_name:    "",
        cnpj:            "",
        whatsapp:        "",
        email:           "",
        address_street:  "",
        address_number:  "",
        address_city:    "",
        address_state:   "",
        address_zip:     "",
    });

    const formRef = useRef<HTMLFormElement>(null);

    const [pixCheckout, setPixCheckout] = useState<{
        url:   string | null;
        code:  string;
        token: string;
    } | null>(null);
    const [pixCopied, setPixCopied] = useState(false);

    const [card, setCard] = useState({
        holder: "",
        number: "",
        exp:    "",
        cvv:    "",
    });

    const plan = selectedPlan ? PLANS.find((p) => p.key === selectedPlan)! : null;

    const pricing = useMemo(() => {
        if (!plan) return null;
        const tier = interval === "yearly" ? plan.yearly : plan.monthly;

        if (interval === "yearly") {
            // Plano anual: cobra o valor anual à vista (sem desconto PIX, sem parcelamento)
            return {
                tier,
                chargeAmount:     tier.annual,
                setupBase:        0,
                setupFinal:       0,
                installmentValue: tier.annual,
            };
        }

        const setupBase  = tier.setup;
        const setupFinal = paymentMethod === "pix" && setupBase > 0
            ? Math.round(setupBase * (1 - PIX_DISCOUNT) * 100) / 100
            : setupBase;
        const installmentValue = setupFinal > 0 && paymentMethod === "credit_card"
            ? setupFinal / installments
            : setupFinal;

        return { tier, chargeAmount: setupFinal, setupBase, setupFinal, installmentValue };
    }, [plan, interval, paymentMethod, installments]);

    function selectPlan(key: PlanKey) {
        setSelectedPlan(key);
        setInstallments(1);
        setError(null);
        setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
    }

    function handleField(k: keyof typeof form, v: string) {
        setForm((f) => ({ ...f, [k]: v }));
        setError(null);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedPlan || !pricing) return;
        setError(null);
        setPixCopied(false);

        let cardToken: string | undefined;

        if (paymentMethod === "credit_card") {
            if (!PAGARME_PUBLIC_KEY) {
                setError(
                    "Pagamento com cartão indisponível: configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY " +
                        "(chave pública do Pagar.me) e cadastre este domínio no painel Pagar.me."
                );
                return;
            }
            const exp = parseCardExpiry(card.exp);
            if (!exp) {
                setError("Validade do cartão: use MM/AA (ex: 08/28).");
                return;
            }
            const num = card.number.replace(/\D/g, "");
            if (num.length < 13) {
                setError("Número do cartão inválido.");
                return;
            }
            const cvv = card.cvv.replace(/\D/g, "");
            if (cvv.length < 3) {
                setError("CVV inválido.");
                return;
            }
            const holder = card.holder.trim() || form.company_name.trim();
            if (holder.length < 3) {
                setError("Informe o nome impresso no cartão.");
                return;
            }
        }

        setLoading(true);
        try {
            if (paymentMethod === "credit_card" && PAGARME_PUBLIC_KEY) {
                const exp = parseCardExpiry(card.exp)!;
                const holder = card.holder.trim() || form.company_name.trim();
                try {
                    cardToken = await pagarmeCreateCardToken(PAGARME_PUBLIC_KEY, {
                        number:          card.number.replace(/\D/g, ""),
                        holder_name:     holder,
                        exp_month:       exp.month,
                        exp_year:        exp.year,
                        cvv:             card.cvv.replace(/\D/g, ""),
                        holder_document: form.cnpj.replace(/\D/g, "") || undefined,
                    });
                } catch (err) {
                    setError(err instanceof Error ? err.message : "Cartão recusado.");
                    return;
                }
            }

            const res = await fetch("/api/billing/signup", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    plan:           selectedPlan,
                    interval,
                    payment_method: paymentMethod,
                    installments:   (interval === "monthly" && paymentMethod === "credit_card")
                        ? installments
                        : 1,
                    setup_cents:    Math.round(pricing.chargeAmount * 100),
                    monthly_cents:  interval === "yearly"
                        ? Math.round(pricing.tier.annual * 100)
                        : Math.round(pricing.tier.price * 100),
                    ...(cardToken ? { card_token: cardToken } : {}),
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Erro ao iniciar pagamento.");
                return;
            }

            if (
                paymentMethod === "pix" &&
                (data.pix_qr_code || data.pix_qr_url) &&
                data.onboarding_token
            ) {
                setPixCheckout({
                    url:   data.pix_qr_url ?? null,
                    code:  (data.pix_qr_code as string) ?? "",
                    token: data.onboarding_token as string,
                });
                return;
            }

            if (paymentMethod === "credit_card" && data.onboarding_token) {
                const tok = data.onboarding_token as string;
                if (data.card_paid === true) {
                    window.location.href = `/signup/complete?token=${encodeURIComponent(tok)}`;
                    return;
                }
                const continueUrl = `${window.location.origin}/signup/complete?token=${encodeURIComponent(tok)}`;
                setError(
                    `Pagamento do cartão em análise. Quando for aprovado, abra: ${continueUrl} ` +
                        "(ou aguarde o webhook; em geral leva menos de um minuto)."
                );
                return;
            }

            setError("Resposta inválida do servidor.");
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    async function copySignupPix() {
        if (!pixCheckout?.code) return;
        try {
            await navigator.clipboard.writeText(pixCheckout.code);
            setPixCopied(true);
            setTimeout(() => setPixCopied(false), 2500);
        } catch {
            setError("Não foi possível copiar. Selecione o código manualmente.");
        }
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    if (pixCheckout) {
        const completeHref = `/signup/complete?token=${encodeURIComponent(pixCheckout.token)}`;
        return (
            <div style={S.page}>
                <div style={{ marginBottom: 28 }}>
                    <Image
                        src="/renthus_logo.png"
                        alt="Renthus"
                        width={148}
                        height={44}
                        style={{ objectFit: "contain" }}
                        priority
                    />
                </div>
                <div
                    style={{
                        width:          "100%",
                        maxWidth:       440,
                        background:     "#fff",
                        borderRadius:   20,
                        padding:        "32px 28px",
                        textAlign:      "center",
                        boxShadow:      "0 24px 64px rgba(0,0,0,0.35)",
                    }}
                >
                    <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#111827" }}>
                        Pague o setup com PIX
                    </h1>
                    <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280", lineHeight: 1.55 }}>
                        Sem página externa do Pagar.me. Depois de pagar, continue para criar sua senha.
                    </p>
                    {pixCheckout.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={pixCheckout.url}
                            alt="QR Code PIX"
                            style={{
                                display:   "block",
                                width:     220,
                                height:    220,
                                margin:    "0 auto 16px",
                                objectFit: "contain",
                            }}
                        />
                    ) : null}
                    {pixCheckout.code ? (
                        <>
                            <label
                                style={{
                                    display:      "block",
                                    textAlign:    "left",
                                    fontSize:     12,
                                    fontWeight:   600,
                                    color:        "#374151",
                                    marginBottom: 6,
                                }}
                            >
                                Pix copia e cola
                            </label>
                            <textarea
                                readOnly
                                value={pixCheckout.code}
                                rows={5}
                                style={{
                                    width:        "100%",
                                    boxSizing:    "border-box",
                                    fontSize:     11,
                                    fontFamily:   "ui-monospace, monospace",
                                    padding:      10,
                                    borderRadius: 8,
                                    border:       "1px solid #e5e7eb",
                                    marginBottom: 10,
                                }}
                                onFocus={(ev) => ev.target.select()}
                            />
                            <button
                                type="button"
                                onClick={copySignupPix}
                                style={{
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
                                }}
                            >
                                {pixCopied ? "Copiado!" : "Copiar código"}
                            </button>
                        </>
                    ) : null}
                    <a
                        href={completeHref}
                        style={{
                            display:        "block",
                            width:          "100%",
                            padding:        "14px 16px",
                            background:     "#22c55e",
                            color:          "#fff",
                            borderRadius:   10,
                            fontWeight:     700,
                            fontSize:       15,
                            textDecoration: "none",
                            boxSizing:      "border-box",
                            marginBottom:   10,
                        }}
                    >
                        Já paguei — continuar cadastro
                    </a>
                    <button
                        type="button"
                        onClick={() => setPixCheckout(null)}
                        style={{
                            background: "transparent",
                            border:     "none",
                            color:      "#6b7280",
                            fontSize:   14,
                            cursor:     "pointer",
                        }}
                    >
                        Voltar
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={S.page}>

            {/* Logo */}
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

            {/* Título */}
            <div style={{ textAlign: "center", marginBottom: 32 }}>
                <h1 style={S.title}>Escolha seu plano</h1>
                <p style={S.subtitle}>30 dias grátis após a ativação · Cancele quando quiser</p>
            </div>

            {/* Toggle Mensal / Anual */}
            <div style={S.toggleWrap}>
                <span style={{ ...S.toggleLabel, opacity: interval === "monthly" ? 1 : 0.5 }}>
                    Mensal
                </span>

                <button
                    type="button"
                    onClick={() => setIntervalMode((i) => i === "monthly" ? "yearly" : "monthly")}
                    style={S.toggleTrack}
                    aria-label="Alternar período"
                >
                    <div style={{
                        ...S.toggleThumb,
                        transform: interval === "yearly" ? "translateX(22px)" : "translateX(2px)",
                    }} />
                </button>

                <span style={{ ...S.toggleLabel, opacity: interval === "yearly" ? 1 : 0.5 }}>
                    Anual
                </span>

                {/* Badge dinâmica: mostra economia máxima ou do plano selecionado */}
                <span style={S.toggleBadge}>
                    {interval === "yearly"
                        ? `Economize até ${fmt(1757)}`
                        : "20% OFF no anual"}
                </span>
            </div>

            {/* Cards */}
            <div style={S.plansRow}>
                {PLANS.map((p) => {
                    const active = selectedPlan === p.key;
                    const tier   = interval === "yearly" ? p.yearly : p.monthly;

                    return (
                        /* Card inteiramente clicável */
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
                            {/* Badge popular */}
                            {p.popular && (
                                <div style={S.popularBadge}>MAIS POPULAR</div>
                            )}

                            <div style={S.planName}>{p.name}</div>
                            <div style={S.planDesc}>{p.description}</div>

                            {/* Preço */}
                            <div style={{ ...S.priceRow, transition: "opacity 0.25s" }}>
                                <span style={S.priceValue}>{fmt(tier.price)}</span>
                                <span style={S.pricePer}>/mês</span>
                                {interval === "yearly" && (
                                    <span style={S.offBadge}>20% OFF</span>
                                )}
                            </div>

                            {interval === "yearly" ? (
                                <>
                                    <div style={S.setupLine}>
                                        {fmt(tier.annual)}/ano · <span style={S.setupFree}>Setup GRÁTIS</span>
                                    </div>
                                    {/* Badge de economia real */}
                                    <div style={S.savingsBadge}>
                                        Economize {fmt(p.yearlySavings)}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={S.setupLine}>
                                        Setup: {fmt(tier.setup)}
                                    </div>
                                    {/* Hint parcelamento — só mensal */}
                                    <div style={S.installmentHint}>
                                        Parcelável em até 10x no cartão de crédito
                                    </div>
                                </>
                            )}

                            {/* Features */}
                            <ul style={S.featureList}>
                                {p.features.map((f) => (
                                    <li key={f} style={S.featureItem}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                            stroke="#FF6B00" strokeWidth="2.5"
                                            strokeLinecap="round" strokeLinejoin="round"
                                            style={{ flexShrink: 0 }}>
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        {f}
                                    </li>
                                ))}
                            </ul>

                            {/* Botão "Quero este plano" — não propaga click (card já propaga) */}
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); selectPlan(p.key); }}
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

            {/* Formulário */}
            {plan && pricing && (
                <form ref={formRef} onSubmit={handleSubmit} style={S.form}>
                    <h2 style={S.formTitle}>Complete sua contratação</h2>

                    {/* Forma de pagamento */}
                    <div style={S.field}>
                        {interval === "yearly" ? (
                            <>
                                <label style={S.label}>Forma de pagamento</label>
                                <div style={S.payRow}>
                                    <button type="button"
                                        onClick={() => setPaymentMethod("pix")}
                                        style={{ ...S.payBtn, ...(paymentMethod === "pix" ? S.payBtnActive : {}) }}>
                                        <span style={{ fontSize: 18 }}>⚡</span>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>PIX</div>
                                            <div style={{ fontSize: 11, opacity: 0.8 }}>à vista</div>
                                        </div>
                                    </button>
                                    <button type="button"
                                        onClick={() => setPaymentMethod("credit_card")}
                                        style={{ ...S.payBtn, ...(paymentMethod === "credit_card" ? S.payBtnActive : {}) }}>
                                        <span style={{ fontSize: 18 }}>💳</span>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>Cartão</div>
                                            <div style={{ fontSize: 11, opacity: 0.8 }}>à vista</div>
                                        </div>
                                    </button>
                                </div>
                                <div style={S.annualPayNote}>
                                    Pagamento único — PIX ou cartão à vista
                                </div>
                            </>
                        ) : (
                            <>
                                <label style={S.label}>Forma de pagamento do setup</label>
                                <div style={S.payRow}>
                                    <button type="button"
                                        onClick={() => { setPaymentMethod("pix"); setInstallments(1); }}
                                        style={{ ...S.payBtn, ...(paymentMethod === "pix" ? S.payBtnActive : {}) }}>
                                        <span style={{ fontSize: 18 }}>⚡</span>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>PIX</div>
                                            <div style={{ fontSize: 11, opacity: 0.8 }}>5% de desconto</div>
                                        </div>
                                    </button>
                                    <button type="button"
                                        onClick={() => setPaymentMethod("credit_card")}
                                        style={{ ...S.payBtn, ...(paymentMethod === "credit_card" ? S.payBtnActive : {}) }}>
                                        <span style={{ fontSize: 18 }}>💳</span>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>Cartão</div>
                                            <div style={{ fontSize: 11, opacity: 0.8 }}>em até 10x</div>
                                        </div>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Parcelamento — só cartão mensal com setup > 0 */}
                    {interval === "monthly" && paymentMethod === "credit_card" && pricing.setupFinal > 0 && (
                        <div style={S.field}>
                            <label style={S.label}>Parcelamento do setup ({fmt(pricing.setupBase)})</label>
                            <select
                                value={installments}
                                onChange={(e) => setInstallments(Number(e.target.value))}
                                style={S.select}
                            >
                                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                        {n}x de {fmt(pricing.setupBase / n)}{n === 1 ? " (à vista)" : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Resumo */}
                    <div style={S.resumoBox}>
                        <div style={S.resumoQuestion}>O que está sendo cobrado agora?</div>

                        {interval === "yearly" ? (
                            <>
                                <div style={S.resumoHighlight}>
                                    Agora: {fmt(pricing.tier.annual)} (plano anual)
                                </div>
                                <div style={S.resumoHighlight}>
                                    Sem cobranças adicionais
                                </div>
                                <div style={S.descontoBadge}>
                                    Setup GRÁTIS · Economize {fmt(plan.yearlySavings)}/ano
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={S.resumoHighlight}>
                                    Agora:{" "}
                                    {paymentMethod === "credit_card" && installments > 1
                                        ? `${installments}x de ${fmt(pricing.installmentValue)} no cartão (setup)`
                                        : `${fmt(pricing.setupFinal)} (setup)${paymentMethod === "pix" ? " via PIX" : ""}`}
                                </div>
                                <div style={S.resumoHighlight}>
                                    Somente daqui a 30 dias será cobrado a mensalidade de {fmt(pricing.tier.price)}/mês
                                </div>
                                {paymentMethod === "pix" && pricing.setupBase > 0 && (
                                    <div style={S.descontoBadge}>
                                        Você economiza {fmt(pricing.setupBase * PIX_DISCOUNT)} com PIX
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Dados da empresa */}
                    <div style={S.sectionLabel}>Dados da empresa</div>

                    <div style={S.field}>
                        <label style={S.label}>Nome da empresa *</label>
                        <input style={S.input} type="text" placeholder="Ex: Disk Bebidas Central"
                            value={form.company_name} onChange={(e) => handleField("company_name", e.target.value)} required />
                    </div>
                    <div style={S.field}>
                        <label style={S.label}>CNPJ *</label>
                        <input style={S.input} type="text" inputMode="numeric" placeholder="00.000.000/0000-00"
                            value={form.cnpj} onChange={(e) => handleField("cnpj", e.target.value)} required />
                    </div>
                    <div style={{ display: "flex", gap: 14 }}>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>WhatsApp *</label>
                            <input style={S.input} type="tel" placeholder="(66) 9 9207-1285"
                                value={form.whatsapp} onChange={(e) => handleField("whatsapp", e.target.value)} required />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>E-mail *</label>
                            <input style={S.input} type="email" placeholder="contato@empresa.com"
                                value={form.email} onChange={(e) => handleField("email", e.target.value)} required />
                        </div>
                    </div>

                    {/* Endereço para faturamento */}
                    <div style={S.sectionLabel}>Endereço de faturamento</div>
                    <div style={S.field}>
                        <label style={S.label}>Rua *</label>
                        <input
                            style={S.input}
                            type="text"
                            placeholder="Ex: Rua das Flores"
                            value={form.address_street}
                            onChange={(e) => handleField("address_street", e.target.value)}
                            required
                        />
                    </div>
                    <div style={{ display: "flex", gap: 14 }}>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>Número *</label>
                            <input
                                style={S.input}
                                type="text"
                                placeholder="Ex: 123"
                                value={form.address_number}
                                onChange={(e) => handleField("address_number", e.target.value)}
                                required
                            />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>CEP *</label>
                            <input
                                style={S.input}
                                type="text"
                                inputMode="numeric"
                                placeholder="78000-000"
                                value={form.address_zip}
                                onChange={(e) => handleField("address_zip", e.target.value)}
                                required
                            />
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 14 }}>
                        <div style={{ ...S.field, flex: 2 }}>
                            <label style={S.label}>Cidade *</label>
                            <input
                                style={S.input}
                                type="text"
                                placeholder="Ex: Cuiabá"
                                value={form.address_city}
                                onChange={(e) => handleField("address_city", e.target.value)}
                                required
                            />
                        </div>
                        <div style={{ ...S.field, flex: 1 }}>
                            <label style={S.label}>UF *</label>
                            <input
                                style={S.input}
                                type="text"
                                maxLength={2}
                                placeholder="MT"
                                value={form.address_state}
                                onChange={(e) => handleField("address_state", e.target.value.toUpperCase())}
                                required
                            />
                        </div>
                    </div>

                    {paymentMethod === "credit_card" && (
                        <>
                            <div style={S.sectionLabel}>Cartão de crédito</div>
                            {!PAGARME_PUBLIC_KEY && (
                                <div style={{ ...S.errorBox, marginBottom: 12 }}>
                                    Defina NEXT_PUBLIC_PAGARME_PUBLIC_KEY (chave pública pk_… do Pagar.me) e cadastre
                                    este domínio no painel do Pagar.me para tokenizar o cartão.
                                </div>
                            )}
                            <div style={S.field}>
                                <label style={S.label}>Nome no cartão *</label>
                                <input
                                    style={S.input}
                                    type="text"
                                    autoComplete="cc-name"
                                    placeholder="Como impresso no cartão (ou deixe em branco para usar o nome da empresa)"
                                    value={card.holder}
                                    onChange={(e) => {
                                        setError(null);
                                        setCard((c) => ({ ...c, holder: e.target.value }));
                                    }}
                                />
                            </div>
                            <div style={S.field}>
                                <label style={S.label}>Número *</label>
                                <input
                                    style={S.input}
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="cc-number"
                                    placeholder="0000 0000 0000 0000"
                                    value={card.number}
                                    onChange={(e) => {
                                        setError(null);
                                        setCard((c) => ({ ...c, number: e.target.value }));
                                    }}
                                />
                            </div>
                            <div style={{ display: "flex", gap: 14 }}>
                                <div style={{ ...S.field, flex: 1 }}>
                                    <label style={S.label}>Validade *</label>
                                    <input
                                        style={S.input}
                                        type="text"
                                        autoComplete="cc-exp"
                                        placeholder="MM/AA"
                                        value={card.exp}
                                        onChange={(e) => {
                                            setError(null);
                                            setCard((c) => ({ ...c, exp: e.target.value }));
                                        }}
                                    />
                                </div>
                                <div style={{ ...S.field, flex: 1 }}>
                                    <label style={S.label}>CVV *</label>
                                    <input
                                        style={S.input}
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="cc-csc"
                                        placeholder="123"
                                        maxLength={4}
                                        value={card.cvv}
                                        onChange={(e) => {
                                            setError(null);
                                            setCard((c) => ({ ...c, cvv: e.target.value }));
                                        }}
                                    />
                                </div>
                            </div>
                            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", margin: "0 0 4px" }}>
                                Os dados do cartão vão direto ao Pagar.me (token); não armazenamos o número completo.
                            </p>
                        </>
                    )}

                    {error && <div style={S.errorBox}>{error}</div>}

                    <button type="submit" disabled={loading}
                        style={{ ...S.submitBtn, opacity: loading ? 0.7 : 1 }}>
                        {loading ? "Gerando link..." : "Contratar agora →"}
                    </button>
                    <p style={S.secureNote}>🔒 Pagamento processado com segurança pelo Pagar.me</p>
                </form>
            )}

            <p style={S.footer}>© {new Date().getFullYear()} Renthus · Todos os direitos reservados</p>

        </div>
    );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------
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
        margin: "0 0 10px",
        fontSize: 34,
        fontWeight: 800,
        color: "#ffffff",
        letterSpacing: "-0.5px",
    },
    subtitle: {
        margin: 0,
        fontSize: 15,
        color: "rgba(255,255,255,0.55)",
    },
    // Toggle
    toggleWrap: {
        display:      "flex",
        alignItems:   "center",
        gap:          10,
        marginBottom: 36,
    },
    toggleLabel: {
        fontSize:   15,
        fontWeight: 600,
        color:      "#fff",
        transition: "opacity 0.2s",
    },
    toggleTrack: {
        width:        48,
        height:       26,
        borderRadius: 999,
        background:   "#FF6B00",
        border:       "none",
        cursor:       "pointer",
        position:     "relative" as const,
        padding:      0,
        flexShrink:   0,
    },
    toggleThumb: {
        width:        22,
        height:       22,
        borderRadius: "50%",
        background:   "#fff",
        position:     "absolute" as const,
        top:          2,
        transition:   "transform 0.2s",
    },
    toggleBadge: {
        background:   "#FF6B00",
        color:        "#fff",
        fontSize:     11,
        fontWeight:   700,
        padding:      "3px 10px",
        borderRadius: 999,
        letterSpacing: "0.3px",
        whiteSpace:   "nowrap" as const,
    },
    // Cards
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
        border:     "2.5px solid #FF6B00",
        boxShadow:  "0 8px 32px rgba(255,107,0,0.25)",
    },
    planCardInactive: {
        border:     "2px solid rgba(255,255,255,0.12)",
        boxShadow:  "0 4px 20px rgba(0,0,0,0.25)",
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
    offBadge: {
        background:   "#FF6B00",
        color:        "#fff",
        fontSize:     10,
        fontWeight:   700,
        padding:      "2px 8px",
        borderRadius: 999,
        marginLeft:   4,
        alignSelf:    "center" as const,
    },
    setupLine: {
        fontSize:     12,
        color:        "#9ca3af",
        marginBottom: 4,
    },
    setupFree: {
        color:      "#22c55e",
        fontWeight: 700,
    },
    savingsBadge: {
        display:      "inline-block",
        background:   "#FF6B00",
        color:        "#fff",
        fontSize:     11,
        fontWeight:   700,
        padding:      "3px 10px",
        borderRadius: 999,
        marginBottom: 14,
        alignSelf:    "flex-start" as const,
    },
    installmentHint: {
        fontSize:     11,
        color:        "#FF6B00",
        fontWeight:   600,
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
    // Formulário
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
    payRow: {
        display: "flex",
        gap:     12,
    },
    payBtn: {
        flex:       1,
        display:    "flex",
        alignItems: "center",
        gap:        10,
        padding:    "12px 14px",
        border:     "1.5px solid #d1d5db",
        borderRadius: 12,
        background: "#f9fafb",
        cursor:     "pointer",
        textAlign:  "left" as const,
        color:      "#111827",
        transition: "all 0.15s",
    },
    payBtnActive: {
        background: "#FF6B00",
        border:     "1.5px solid #FF6B00",
        color:      "#fff",
        boxShadow:  "0 3px 12px rgba(255,107,0,0.30)",
    },
    annualPayNote: {
        fontSize:   12,
        color:      "#6b7280",
        marginTop:  4,
        fontWeight: 500,
    },
    resumoBox: {
        background:   "#fff7ed",
        border:       "1px solid #fed7aa",
        borderRadius: 12,
        padding:      "14px 16px",
        marginBottom: 20,
    },
    resumoLine: {
        display:    "flex",
        alignItems: "flex-start",
        gap:        8,
        fontSize:   13,
        color:      "#7c2d12",
        lineHeight: 1.5,
    },
    resumoIcon: {
        flexShrink: 0,
        fontSize:   14,
    },
    resumoQuestion: {
        fontSize:     11,
        color:        "#9a6830",
        marginBottom: 6,
        fontWeight:   500,
    },
    resumoHighlight: {
        fontSize:     13,
        fontWeight:   700,
        color:        "#7c2d12",
        lineHeight:   1.6,
    },
    descontoBadge: {
        marginTop:    10,
        display:      "inline-block",
        background:   "#22c55e",
        color:        "#fff",
        fontSize:     11,
        fontWeight:   700,
        padding:      "3px 10px",
        borderRadius: 999,
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
    overlay: {
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
