"use client";

/**
 * app/(public)/signup/page.tsx  →  rota: /signup
 *
 * Landing comercial MVP Zampell Delivery + checkout na mesma tela.
 * Trial configurável no platform (default 0 = pagamento antes de usar).
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/PasswordInput";
import { BillingPeriodToggle } from "@/components/billing/BillingPeriodToggle";
import {
    PLAN_CARD_ACCENT,
    PLAN_CARD_ACCENT_FG,
    PLAN_CARD_ACCENT_SHADOW,
    PLAN_TOGGLE_ACCENT,
} from "@/lib/billing/planOfferUi";
import { PLAN_CATALOG, PLAN_ORDER, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import { yearlySavingsPercent } from "@/lib/billing/yearlyFromDiscount";
import {
    mixpanelIdentify,
    trackSignUpCompleted,
} from "@/lib/analytics/mixpanelBrowser";

type TrialPolicy = { trial_days: number; payment_required: boolean };

type BillingPeriod = "month" | "year";

type PlanFeatureRow =
    | { kind: "item"; label: string; ai?: boolean }
    | { kind: "plus" };

type SignupPlanCard = {
    key: CommercialPlanKey;
    name: string;
    popular: boolean;
    description: string;
    listMonthlyCents: number;
    offerMonthlyCents: number;
    listYearlyCents: number | null;
    yearlySavingsPercent: number;
    promoLabel: string | null;
    features: PlanFeatureRow[];
};

/** Copy de recursos da vitrine — só WhatsApp (sem IG/Messenger). */
const PLAN_CARD_PITCH: Record<CommercialPlanKey, string> = {
    essencial: "Pra quem precisa parar de anotar pedido no Zap e ter um cardápio decente.",
    pro: "Pra quem já vende todo dia e precisa que o pedido vire comanda, estoque e caixa — sem retrabalho.",
    market: "Pra operação com mais gente no painel no mesmo horário.",
};

const PLAN_FEATURE_BLURBS: Record<CommercialPlanKey, PlanFeatureRow[]> = {
    essencial: [
        { kind: "item", label: "Agente IA no WhatsApp", ai: true },
        { kind: "item", label: "Cardápio web inteligente" },
        { kind: "item", label: "PDV básico pra vender no balcão" },
        { kind: "item", label: "Cadastro de produtos" },
    ],
    pro: [
        { kind: "item", label: "Agente IA no WhatsApp", ai: true },
        { kind: "item", label: "Tudo do Essencial" },
        { kind: "plus" },
        { kind: "item", label: "Pedido sai sozinho na impressora" },
        { kind: "item", label: "PDV completo" },
        { kind: "item", label: "Gestão de estoque" },
        { kind: "item", label: "Controle financeiro" },
        { kind: "item", label: "Templates e campanhas no WhatsApp" },
        { kind: "item", label: "01 usuário" },
    ],
    market: [
        { kind: "item", label: "Agente IA no WhatsApp", ai: true },
        { kind: "item", label: "Tudo do Essencial" },
        { kind: "plus" },
        { kind: "item", label: "Pedido sai sozinho na impressora" },
        { kind: "item", label: "PDV completo" },
        { kind: "item", label: "Gestão de estoque" },
        { kind: "item", label: "Controle financeiro" },
        { kind: "item", label: "Templates e campanhas no WhatsApp" },
        { kind: "item", label: "10 usuários" },
    ],
};

const HERO_BENEFITS = [
    "Você controla pelo seu telefone ou computador.",
    "Impressão do pedido automático, não precisa escrever à mão.",
    "Cliente não precisa baixar aplicativo.",
    "O canal é todo seu, sem taxas por vendas — sem comer seus lucros.",
] as const;

const HOW_STEPS = [
    "Cadastra o que você vende e publica o cardápio.",
    "O cliente pede no WhatsApp — o agente monta o pedido.",
    "Você confirma e manda sair. No Pro e no Market a comanda imprime, o estoque baixa e o valor entra no financeiro.",
] as const;

const FAQ_ITEMS = [
    {
        q: "Preciso falar com vendedor pra começar?",
        a: "Não. Escolhe o plano, cria a conta e paga.",
    },
    {
        q: "Funciona no celular?",
        a: "Sim. Celular ou computador.",
    },
    {
        q: "Imprime comanda?",
        a: "No Pro e no Market o pedido vai direto pra impressora.",
    },
    {
        q: "O cliente precisa baixar app?",
        a: "Não. Abre o cardápio no navegador ou pede no WhatsApp.",
    },
    {
        q: "Dá pra mais de uma pessoa usar?",
        a: "Essencial e Pro: 1 usuário. Market: 10. No Pro e no Market dá pra adicionar gente extra (R$ 99/mês).",
    },
] as const;

function AiSparklesIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            style={{ flexShrink: 0 }}
            aria-hidden
        >
            <defs>
                <linearGradient id="zampell-ai-spark" x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#7C3AED" />
                    <stop offset="45%" stopColor="#22D3EE" />
                    <stop offset="100%" stopColor="#57FF8F" />
                </linearGradient>
            </defs>
            <path
                fill="url(#zampell-ai-spark)"
                d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
            />
            <path fill="url(#zampell-ai-spark)" d="M19.2 2.2 20 5.1 22.9 5.9 20 6.7 19.2 9.6 18.4 6.7 15.5 5.9 18.4 5.1z" />
            <path fill="url(#zampell-ai-spark)" d="M4.3 16.4 4.8 18.2 6.6 18.7 4.8 19.2 4.3 21 3.8 19.2 2 18.7 3.8 18.2z" />
        </svg>
    );
}

function FeatureCheckIcon({ color }: { color: string }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
            aria-hidden
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function catalogFallbackPlans(): SignupPlanCard[] {
    return PLAN_ORDER.map((key) => {
        const c = PLAN_CATALOG[key];
        return {
            key,
            name: c.name,
            popular: Boolean(c.popular),
            description: PLAN_CARD_PITCH[key],
            listMonthlyCents: c.monthlyPriceCents,
            offerMonthlyCents: c.monthlyPriceCents,
            listYearlyCents: c.yearlyPriceCents ?? null,
            yearlySavingsPercent: yearlySavingsPercent(
                c.monthlyPriceCents,
                c.yearlyPriceCents
            ),
            promoLabel: null,
            features: PLAN_FEATURE_BLURBS[key],
        };
    });
}

type PlanKey = CommercialPlanKey;
function fmtCents(cents: number) {
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Valor/mês equivalente do plano anual (anual à vista ÷ 12). */
function yearlyPerMonthCents(yearlyCents: number) {
    return Math.round(yearlyCents / 12);
}

async function syncServerSession(session: Session | null) {
    if (!session) return false;
    try {
        const response = await fetch("/api/auth/sync-session", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                access_token:  session.access_token,
                refresh_token: session.refresh_token,
            }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export default function SignupPage() {
    const router   = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null);
    const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("year");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [trialPolicy, setTrialPolicy] = useState<TrialPolicy>({
        trial_days:       0,
        payment_required: true,
    });
    const [policyLoaded, setPolicyLoaded] = useState(false);
    const [plans, setPlans] = useState<SignupPlanCard[]>(() => catalogFallbackPlans());
    const [form, setForm] = useState({
        company_name:      "",
        cnpj:              "",
        whatsapp:          "",
        email:             "",
        password:          "",
        password_confirm:  "",
    });

    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/trial-policy", { cache: "no-store" })
            .then((r) => r.json())
            .then((d: TrialPolicy) => {
                if (!cancelled && typeof d.trial_days === "number") {
                    setTrialPolicy({
                        trial_days:       d.trial_days,
                        payment_required: Boolean(d.payment_required),
                    });
                }
            })
            .catch(() => {
                /* mantém default pay-to-start */
            })
            .finally(() => {
                if (!cancelled) setPolicyLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/public-plans", { cache: "no-store" })
            .then((r) => r.json())
            .then(
                (d: {
                    plans?: Array<{
                        key: string;
                        name: string;
                        description: string | null;
                        list_monthly_cents: number;
                        offer_monthly_cents: number;
                        list_yearly_cents: number | null;
                        yearly_savings_percent?: number;
                        popular: boolean;
                        promo: { label_de_por: string } | null;
                    }>;
                }) => {
                    if (cancelled || !Array.isArray(d.plans) || d.plans.length === 0) return;
                    const next: SignupPlanCard[] = [];
                    for (const key of PLAN_ORDER) {
                        const row = d.plans.find((p) => p.key === key);
                        const c = PLAN_CATALOG[key];
                        if (!row) {
                            next.push(catalogFallbackPlans().find((p) => p.key === key)!);
                            continue;
                        }
                        next.push({
                            key,
                            name: row.name || c.name,
                            popular: Boolean(row.popular ?? c.popular),
                            /** Copy comercial canônico no código (não ecoar texto legado do DB). */
                            description: PLAN_CARD_PITCH[key],
                            listMonthlyCents: row.list_monthly_cents,
                            offerMonthlyCents: row.offer_monthly_cents,
                            listYearlyCents:
                                typeof row.list_yearly_cents === "number" &&
                                row.list_yearly_cents > 0
                                    ? row.list_yearly_cents
                                    : (c.yearlyPriceCents ?? null),
                            yearlySavingsPercent:
                                typeof row.yearly_savings_percent === "number" &&
                                row.yearly_savings_percent > 0
                                    ? row.yearly_savings_percent
                                    : yearlySavingsPercent(
                                          row.list_monthly_cents,
                                          row.list_yearly_cents ?? c.yearlyPriceCents
                                      ),
                            promoLabel: row.promo?.label_de_por ?? null,
                            features: PLAN_FEATURE_BLURBS[key],
                        });
                    }
                    setPlans(next);
                }
            )
            .catch(() => {
                /* fallback catalog */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const plan = selectedPlan ? plans.find((p) => p.key === selectedPlan)! : null;
    const maxYearlyPct = Math.max(0, ...plans.map((p) => p.yearlySavingsPercent));

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
                    billing_period:   billingPeriod,
                    password:         form.password,
                    password_confirm: form.password_confirm,
                }),
            });
            const data = (await res.json()) as {
                error?: string;
                company_id?: string;
                payment_required?: boolean;
            };
            if (!res.ok) {
                setError(data.error ?? "Não foi possível concluir o cadastro.");
                return;
            }

            const emailLogin = form.email.trim().toLowerCase();
            const { data: signInData, error: signErr } = await supabase.auth.signInWithPassword({
                email:    emailLogin,
                password: form.password,
            });
            if (signErr || !signInData.session) {
                setError(
                    signErr?.message ??
                        "Conta criada, mas não foi possível entrar automaticamente. Acesse a tela de login."
                );
                router.push("/login?cadastro=ok");
                return;
            }

            const synced = await syncServerSession(signInData.session);
            if (!synced) {
                setError("Sessão não sincronizada. Faça login manualmente.");
                router.push("/login?cadastro=ok");
                return;
            }

            if (data.company_id) {
                const sel = await fetch("/api/workspace/select", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({ company_id: data.company_id }),
                });
                if (!sel.ok) {
                    setError("Empresa criada, mas não foi possível selecionar o workspace. Faça login e escolha a empresa.");
                    router.push("/login");
                    return;
                }
            }

            const u = signInData.session.user;
            mixpanelIdentify(u.id, {
                email: u.email ?? null,
                company_id: data.company_id ?? null,
            });
            trackSignUpCompleted({
                sign_up_method: "email",
                platform: "web",
                plan: selectedPlan,
                billing_period: billingPeriod,
                company_id: data.company_id ?? null,
            });

            window.location.assign(
                data.payment_required ? "/plano/pagar" : "/ativar"
            );
            return;
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={S.page}>
            <div style={S.brandRow}>
                <img
                    src="/brand/icone-512-transparente.svg?v=z1"
                    alt=""
                    width={40}
                    height={40}
                    style={{
                        height: 40,
                        width: 40,
                        display: "block",
                        flexShrink: 0,
                    }}
                />
                <img
                    src="/brand/zampell-wordmark.svg?v=z1"
                    alt="Zampell"
                    width={176}
                    height={48}
                    style={{
                        height: 40,
                        width: "auto",
                        display: "block",
                        flexShrink: 0,
                    }}
                />
                <span style={S.brandProduct}>Delivery</span>
            </div>

            <div style={S.hero}>
                <p style={S.slogan}>Agentes inteligentes para o seu delivery.</p>
                <h1 style={S.title}>
                    O WhatsApp do seu delivery atende e anota o pedido?
                </h1>
                <p style={S.heroAnswer}>O nosso sim!</p>
                <p style={S.subtitle}>
                    Conheça o nosso agente de IA que atende, anota e imprime o pedido na hora.
                </p>
                <ul style={S.heroBenefits}>
                    {HERO_BENEFITS.map((line) => (
                        <li key={line} style={S.heroBenefitItem}>
                            <FeatureCheckIcon color={BRAND.accent} />
                            <span>{line}</span>
                        </li>
                    ))}
                </ul>
                <div style={S.heroCtas}>
                    <a href="#planos" style={S.heroCtaPrimary}>
                        Escolher plano e começar
                    </a>
                    <a href="/login" style={S.heroCtaSecondary}>
                        Já tenho conta · Entrar
                    </a>
                </div>
                <p style={S.policyLine}>
                    Sem taxa pra começar · Paga e usa · Cancela quando quiser
                    {policyLoaded && !trialPolicy.payment_required
                        ? ` · ${trialPolicy.trial_days} dias de teste`
                        : ""}
                </p>
            </div>

            <div style={S.periodToggleWrap} id="planos">
                <BillingPeriodToggle
                    appearance="onDark"
                    value={billingPeriod}
                    onValueChange={setBillingPeriod}
                    yearlyHint={
                        maxYearlyPct > 0 ? `economize até ${maxYearlyPct}%` : null
                    }
                    disabled={loading}
                />
            </div>

            <div style={S.plansRow} role="radiogroup" aria-label="Planos disponíveis">
                {plans.map((p) => {
                    const active = selectedPlan === p.key;
                    const hasPromo =
                        p.promoLabel != null && p.offerMonthlyCents < p.listMonthlyCents;
                    const showYear =
                        billingPeriod === "year" &&
                        p.listYearlyCents != null &&
                        p.listYearlyCents > 0;
                    const yearPerMonth = showYear ? yearlyPerMonthCents(p.listYearlyCents!) : 0;
                    const yearPct = showYear ? p.yearlySavingsPercent : 0;
                    return (
                        <div
                            key={p.key}
                            role="radio"
                            aria-checked={active}
                            style={{
                                ...S.planCard,
                                ...(active ? S.planCardActive : S.planCardInactive),
                                cursor: "default",
                            }}
                        >
                            {p.popular && <div style={S.popularBadge}>MAIS POPULAR</div>}
                            <div style={S.planName}>{p.name}</div>
                            <div style={S.planDesc}>{p.description}</div>
                            <div style={{ ...S.priceRow, transition: "opacity 0.25s" }}>
                                {showYear ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                        <span
                                            style={{
                                                ...S.pricePer,
                                                textDecoration: "line-through",
                                                opacity: 0.75,
                                            }}
                                        >
                                            De {fmtCents(p.listMonthlyCents)}/mês
                                        </span>
                                        <span>
                                            <span style={S.priceValue}>
                                                {fmtCents(yearPerMonth)}
                                            </span>
                                            <span style={S.pricePer}>/mês</span>
                                        </span>
                                    </div>
                                ) : hasPromo ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                        <span
                                            style={{
                                                ...S.pricePer,
                                                textDecoration: "line-through",
                                                opacity: 0.75,
                                            }}
                                        >
                                            De {fmtCents(p.listMonthlyCents)}
                                        </span>
                                        <span>
                                            <span style={S.priceValue}>
                                                {fmtCents(p.offerMonthlyCents)}
                                            </span>
                                            <span style={S.pricePer}>/mês</span>
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        <span style={S.priceValue}>
                                            {fmtCents(p.offerMonthlyCents)}
                                        </span>
                                        <span style={S.pricePer}>/mês</span>
                                    </>
                                )}
                            </div>
                            {showYear ? (
                                <div style={{ ...S.setupLine, color: BRAND.planAccent, fontWeight: 600 }}>
                                    {fmtCents(p.listYearlyCents!)}/ano à vista
                                    {yearPct > 0 ? ` · economize ${yearPct}%` : ""}
                                </div>
                            ) : (
                                hasPromo && (
                                    <div style={{ ...S.setupLine, color: BRAND.planAccent, fontWeight: 600 }}>
                                        {p.promoLabel}
                                    </div>
                                )
                            )}
                            <div style={S.setupLine}>
                                {trialPolicy.payment_required
                                    ? "Pague para começar · cancele quando quiser"
                                    : "Após o teste · cancele quando quiser"}
                            </div>
                            <ul style={S.featureList}>
                                {p.features.map((f, idx) => {
                                    if (f.kind === "plus") {
                                        return (
                                            <li
                                                key={`plus-${idx}`}
                                                style={S.featurePlus}
                                                aria-hidden
                                            >
                                                <span style={S.featurePlusGlyph}>+</span>
                                            </li>
                                        );
                                    }
                                    return (
                                        <li key={`${f.label}-${idx}`} style={S.featureItem}>
                                            {f.ai ? (
                                                <AiSparklesIcon />
                                            ) : (
                                                <FeatureCheckIcon color={BRAND.planAccent} />
                                            )}
                                            <span>{f.label}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                            <button
                                type="button"
                                onClick={() => selectPlan(p.key)}
                                aria-pressed={active}
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
                    <h2 style={S.formTitle}>Criar conta e pagar</h2>

                    <div style={S.resumoBox}>
                        <div style={S.resumoQuestion}>Como funciona</div>
                        {(() => {
                            const isYear =
                                billingPeriod === "year" &&
                                plan.listYearlyCents != null &&
                                plan.listYearlyCents > 0;
                            const chargeLabel = isYear
                                ? `${fmtCents(plan.listYearlyCents!)}/ano à vista`
                                : `${fmtCents(plan.offerMonthlyCents)}/mês`;
                            const cicloLabel = isYear ? "plano anual" : "1ª mensalidade";
                            return trialPolicy.payment_required ? (
                                <>
                                    <div style={S.resumoHighlight}>
                                        Após criar a conta, você paga o {cicloLabel} do {plan.name} (
                                        {chargeLabel}) por PIX ou cartão.
                                    </div>
                                    <div style={S.resumoHighlight}>
                                        Só depois do pagamento você acessa o painel e configura WhatsApp e
                                        produtos.
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={S.resumoHighlight}>
                                        Você usa o sistema grátis por {trialPolicy.trial_days} dias (plano{" "}
                                        {plan.name}).
                                    </div>
                                    <div style={S.resumoHighlight}>
                                        Quando o teste acabar, enviamos a cobrança do {cicloLabel} (
                                        {chargeLabel}) por PIX. Ao pagar, o acesso continua normalmente —
                                        sem novo cadastro.
                                    </div>
                                </>
                            );
                        })()}
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
                        <PasswordInput
                            style={S.input}
                            value={form.password}
                            onChange={(e) => handleField("password", e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                        />
                    </div>
                    <div style={S.field}>
                        <label style={S.label}>Confirmar senha *</label>
                        <PasswordInput
                            style={S.input}
                            value={form.password_confirm}
                            onChange={(e) => handleField("password_confirm", e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                        />
                    </div>

                    {error && <div style={S.errorBox}>{error}</div>}

                    <button type="submit" disabled={loading} style={{ ...S.submitBtn, opacity: loading ? 0.7 : 1 }}>
                        {loading
                            ? "Criando conta…"
                            : policyLoaded && trialPolicy.payment_required
                              ? "Criar conta e ir para pagamento →"
                              : "Criar conta e começar o teste →"}
                    </button>
                    <p style={S.secureNote}>
                        {policyLoaded && trialPolicy.payment_required
                            ? "Ao continuar, você será direcionado ao pagamento da primeira mensalidade para liberar o acesso."
                            : "Ao continuar, você concorda em usar o sistema nas condições do período de teste e da mensalidade após o vencimento."}
                    </p>
                </form>
            )}

            <section style={S.howSection} aria-labelledby="como-funciona">
                <h2 id="como-funciona" style={S.sectionHeading}>
                    Como funciona
                </h2>
                <ol style={S.howList}>
                    {HOW_STEPS.map((step, i) => (
                        <li key={step} style={S.howItem}>
                            <span style={S.howNum}>{i + 1}</span>
                            <span>{step}</span>
                        </li>
                    ))}
                </ol>
            </section>

            <section style={S.faqSection} aria-labelledby="faq">
                <h2 id="faq" style={S.sectionHeading}>
                    Perguntas frequentes
                </h2>
                <div style={S.faqList}>
                    {FAQ_ITEMS.map((item) => (
                        <details key={item.q} style={S.faqItem}>
                            <summary style={S.faqSummary}>{item.q}</summary>
                            <p style={S.faqAnswer}>{item.a}</p>
                        </details>
                    ))}
                </div>
            </section>

            <section style={S.finalCta} aria-labelledby="cta-final">
                <h2 id="cta-final" style={S.finalTitle}>
                    Cansou de anotar pedido no Zap e conferir depois se saiu certo?
                </h2>
                <p style={S.finalSub}>
                    Escolhe o plano, ativa o agente e deixa o pedido cair no painel.
                </p>
                <a href="#planos" style={S.heroCtaPrimary}>
                    Começar com Zampell Delivery
                </a>
            </section>

            <div style={S.otherProducts}>
                <div style={S.otherProductsLabel}>Outros produtos Zampell</div>
                <div style={S.otherProductsRow}>
                    <span style={S.otherProductChip}>Clínicas · em breve</span>
                    <span style={S.otherProductChip}>Estética · em breve</span>
                </div>
            </div>

            <p style={S.loginLine}>
                Já tem conta?{" "}
                <a href="/login" style={S.loginLink}>
                    Entrar
                </a>
            </p>
            <p style={S.footer}>
                © {new Date().getFullYear()} Zampell · Todos os direitos reservados
            </p>
        </div>
    );
}

const BRAND = {
    primary:     "#16364D",
    primaryDeep: "#11283B",
    accent:      PLAN_TOGGLE_ACCENT,
    accentFg:    "#16364D",
    planAccent:  PLAN_CARD_ACCENT,
    planAccentFg: PLAN_CARD_ACCENT_FG,
} as const;

const S = {
    page: {
        minHeight:     "100vh",
        background:    BRAND.primaryDeep,
        display:       "flex",
        flexDirection: "column" as const,
        alignItems:    "center",
        padding:       "40px 24px 64px",
        fontFamily:    "'Inter', 'Segoe UI', system-ui, sans-serif",
        boxSizing:     "border-box" as const,
    },
    brandRow: {
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        gap:            14,
        marginBottom:   28,
        width:          "100%",
        flexWrap:       "wrap" as const,
    },
    brandProduct: {
        fontSize:      11,
        fontWeight:    700,
        color:         BRAND.primaryDeep,
        letterSpacing: "0.06em",
        textTransform: "uppercase" as const,
        background:    BRAND.accent,
        borderRadius:  999,
        padding:       "6px 12px",
    },
    hero: {
        textAlign:    "center" as const,
        marginBottom: 40,
        maxWidth:     720,
        padding:      "0 8px",
    },
    slogan: {
        margin:        "0 0 14px",
        fontSize:      13,
        fontWeight:    600,
        color:         BRAND.accent,
        letterSpacing: "0.02em",
    },
    title: {
        margin:        "0 0 12px",
        fontSize:      "clamp(26px, 5vw, 36px)",
        fontWeight:    800,
        color:         "#ffffff",
        letterSpacing: "-0.6px",
        lineHeight:    1.15,
    },
    heroAnswer: {
        margin:        "0 0 12px",
        fontSize:      "clamp(28px, 5vw, 40px)",
        fontWeight:    800,
        color:         BRAND.accent,
        letterSpacing: "-0.6px",
        lineHeight:    1.15,
    },
    subtitle: {
        margin:     "0 0 22px",
        fontSize:   16,
        lineHeight: 1.5,
        color:      "rgba(255,255,255,0.78)",
    },
    heroBenefits: {
        listStyle:     "none",
        margin:        "0 auto 24px",
        padding:       0,
        display:       "flex",
        flexDirection: "column" as const,
        gap:           12,
        textAlign:     "left" as const,
        maxWidth:      520,
        width:         "100%",
    },
    heroBenefitItem: {
        display:    "flex",
        alignItems: "flex-start",
        gap:        10,
        fontSize:   15,
        lineHeight: 1.45,
        color:      "rgba(255,255,255,0.86)",
        fontWeight: 500,
    },
    policyLine: {
        margin:     0,
        fontSize:   13,
        lineHeight: 1.45,
        color:      "rgba(255,255,255,0.48)",
    },
    heroCtas: {
        display:        "flex",
        flexWrap:       "wrap" as const,
        gap:            12,
        justifyContent: "center",
        marginBottom:   16,
    },
    heroCtaPrimary: {
        display:        "inline-flex",
        alignItems:     "center",
        justifyContent: "center",
        background:     BRAND.accent,
        color:          BRAND.accentFg,
        fontWeight:     800,
        fontSize:       15,
        textDecoration: "none",
        borderRadius:   999,
        padding:        "12px 22px",
    },
    heroCtaSecondary: {
        display:        "inline-flex",
        alignItems:     "center",
        justifyContent: "center",
        color:          "rgba(255,255,255,0.82)",
        fontWeight:     600,
        fontSize:       14,
        textDecoration: "none",
        borderRadius:   999,
        padding:        "12px 18px",
        border:         "1px solid rgba(255,255,255,0.22)",
    },
    pillars: {
        display:        "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
        gap:            16,
        width:          "100%",
        maxWidth:       1120,
        marginBottom:   40,
    },
    pillarCard: {
        background:   "rgba(255,255,255,0.05)",
        border:       "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18,
        padding:      "20px 18px",
    },
    pillarTitle: {
        margin:     "0 0 8px",
        fontSize:   16,
        fontWeight: 700,
        color:      "#ffffff",
        lineHeight: 1.3,
    },
    pillarBody: {
        margin:     0,
        fontSize:   14,
        lineHeight: 1.5,
        color:      "rgba(255,255,255,0.68)",
    },
    sectionHeading: {
        margin:        "0 0 20px",
        fontSize:      22,
        fontWeight:    800,
        color:         "#ffffff",
        textAlign:     "center" as const,
    },
    howSection: {
        width:     "100%",
        maxWidth:  720,
        marginTop: 8,
        marginBottom: 40,
    },
    howList: {
        listStyle: "none",
        margin:    0,
        padding:   0,
        display:   "flex",
        flexDirection: "column" as const,
        gap:       14,
    },
    howItem: {
        display:    "flex",
        alignItems: "flex-start",
        gap:        12,
        color:      "rgba(255,255,255,0.78)",
        fontSize:   15,
        lineHeight: 1.5,
    },
    howNum: {
        flexShrink:  0,
        width:       28,
        height:      28,
        borderRadius: 999,
        background:  BRAND.accent,
        color:       BRAND.accentFg,
        fontWeight:  800,
        fontSize:    14,
        display:     "inline-flex",
        alignItems:  "center",
        justifyContent: "center",
    },
    faqSection: {
        width:        "100%",
        maxWidth:     720,
        marginBottom: 40,
    },
    faqList: {
        display:       "flex",
        flexDirection: "column" as const,
        gap:           10,
    },
    faqItem: {
        background:   "rgba(255,255,255,0.05)",
        border:       "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding:      "4px 16px 4px",
    },
    faqSummary: {
        cursor:     "pointer",
        fontWeight: 700,
        fontSize:   15,
        color:      "#ffffff",
        padding:    "12px 0",
        listStyle:  "none",
    },
    faqAnswer: {
        margin:     "0 0 14px",
        fontSize:   14,
        lineHeight: 1.5,
        color:      "rgba(255,255,255,0.68)",
    },
    finalCta: {
        width:        "100%",
        maxWidth:     640,
        textAlign:    "center" as const,
        marginBottom: 48,
        padding:      "8px",
    },
    finalTitle: {
        margin:     "0 0 12px",
        fontSize:   "clamp(20px, 4vw, 26px)",
        fontWeight: 800,
        color:      "#ffffff",
        lineHeight: 1.25,
    },
    finalSub: {
        margin:     "0 0 20px",
        fontSize:   15,
        lineHeight: 1.5,
        color:      "rgba(255,255,255,0.68)",
    },
    periodToggleWrap: {
        display:        "flex",
        justifyContent: "center",
        width:          "100%",
        marginBottom:   28,
    },
    periodToggle: {
        display:      "inline-flex",
        background:   "rgba(255,255,255,0.08)",
        border:       "1px solid rgba(255,255,255,0.14)",
        borderRadius: 999,
        padding:      4,
        gap:          4,
    },
    periodBtn: {
        display:      "inline-flex",
        alignItems:   "center",
        gap:          8,
        border:       "none",
        background:   "transparent",
        color:        "rgba(255,255,255,0.7)",
        fontSize:     14,
        fontWeight:   700,
        padding:      "9px 20px",
        borderRadius: 999,
        cursor:       "pointer",
        transition:   "all 0.15s",
    },
    periodBtnActive: {
        background: BRAND.accent,
        color:      BRAND.accentFg,
        boxShadow:  "0 3px 10px rgba(87,255,143,0.35)",
    },
    periodBtnHint: {
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: "0.2px",
        opacity:       0.85,
    },
    plansRow: {
        display:        "flex",
        gap:            28,
        flexWrap:       "wrap" as const,
        justifyContent: "center",
        alignItems:     "stretch",
        width:          "100%",
        maxWidth:       1120,
        marginBottom:   40,
    },
    planCard: {
        position:      "relative" as const,
        borderRadius:  28,
        padding:       "36px 28px 28px",
        flex:          "1 1 280px",
        minWidth:      260,
        minHeight:     520,
        display:       "flex",
        flexDirection: "column" as const,
        background:    "#fff",
        cursor:        "pointer",
        outline:       "none",
        boxSizing:     "border-box" as const,
        transition:    "box-shadow 0.15s, border-color 0.15s, transform 0.15s",
    },
    planCardActive: {
        border:    `2.5px solid ${BRAND.planAccent}`,
        boxShadow: `0 12px 36px ${PLAN_CARD_ACCENT_SHADOW}`,
        transform: "translateY(-2px)",
    },
    planCardInactive: {
        border:    "2px solid transparent",
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
    },
    popularBadge: {
        position:      "absolute" as const,
        top:           -13,
        left:          "50%",
        transform:     "translateX(-50%)",
        background:    BRAND.planAccent,
        color:         BRAND.planAccentFg,
        fontSize:      10,
        fontWeight:    800,
        padding:       "4px 14px",
        borderRadius:  999,
        letterSpacing: "1px",
        whiteSpace:    "nowrap" as const,
    },
    planName: {
        fontSize:     22,
        fontWeight:   800,
        color:        "#111827",
        marginBottom: 6,
    },
    planDesc: {
        fontSize:     14,
        color:        "#6b7280",
        marginBottom: 22,
        lineHeight:   1.5,
    },
    priceRow: {
        display:      "flex",
        alignItems:   "baseline",
        gap:          4,
        marginBottom: 6,
    },
    priceValue: {
        fontSize:   32,
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
        marginBottom: 20,
    },
    featureList: {
        listStyle:     "none",
        margin:        "0 0 28px",
        padding:       0,
        display:       "flex",
        flexDirection: "column" as const,
        gap:           12,
        flex:          1,
    },
    featureItem: {
        display:    "flex",
        alignItems: "flex-start",
        gap:        10,
        fontSize:   14,
        color:      "#374151",
        fontWeight: 500,
        lineHeight: 1.4,
    },
    featurePlus: {
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        listStyle:      "none",
        margin:         "2px 0",
        padding:        0,
    },
    featurePlusGlyph: {
        display:         "inline-flex",
        alignItems:      "center",
        justifyContent:  "center",
        width:           28,
        height:          28,
        borderRadius:    999,
        background:      "rgba(26, 143, 74, 0.12)",
        color:           BRAND.planAccent,
        fontSize:        20,
        fontWeight:      700,
        lineHeight:      1,
        border:          `1.5px solid ${BRAND.planAccent}`,
    },
    planBtn: {
        width:        "100%",
        padding:      "14px 0",
        border:       "none",
        borderRadius: 12,
        fontSize:     15,
        fontWeight:   700,
        cursor:       "pointer",
        marginTop:    "auto",
        transition:   "all 0.15s",
    },
    planBtnInactive: {
        background: BRAND.planAccent,
        color:      BRAND.planAccentFg,
        boxShadow:  `0 3px 10px ${PLAN_CARD_ACCENT_SHADOW}`,
    },
    planBtnActive: {
        background: BRAND.primary,
        color:      BRAND.planAccent,
    },
    form: {
        background:      "#fff",
        borderRadius:    24,
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
        background:   "#ecfdf5",
        border:       `1px solid ${BRAND.accent}`,
        borderRadius: 12,
        padding:      "14px 16px",
        marginBottom: 20,
    },
    resumoQuestion: {
        fontSize:     11,
        color:        "#3d6b52",
        marginBottom: 6,
        fontWeight:   500,
    },
    resumoHighlight: {
        fontSize:     13,
        fontWeight:   600,
        color:        BRAND.primary,
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
        background:   BRAND.accent,
        color:        BRAND.accentFg,
        border:       "none",
        borderRadius: 12,
        fontSize:     16,
        fontWeight:   700,
        cursor:       "pointer",
        boxShadow:    "0 4px 14px rgba(87,255,143,0.40)",
        marginBottom: 12,
    },
    secureNote: {
        margin:    0,
        textAlign: "center" as const,
        fontSize:  12,
        color:     "#9ca3af",
    },
    otherProducts: {
        marginTop:  48,
        textAlign:  "center" as const,
        maxWidth:   480,
        width:      "100%",
    },
    otherProductsLabel: {
        fontSize:      11,
        fontWeight:    600,
        letterSpacing: "0.06em",
        textTransform: "uppercase" as const,
        color:         "rgba(255,255,255,0.40)",
        marginBottom:  12,
    },
    otherProductsRow: {
        display:        "flex",
        flexWrap:       "wrap" as const,
        gap:            8,
        justifyContent: "center",
    },
    otherProductChip: {
        fontSize:     12,
        fontWeight:   500,
        color:        "rgba(255,255,255,0.55)",
        border:       "1px solid rgba(255,255,255,0.14)",
        borderRadius: 999,
        padding:      "6px 12px",
        background:   "rgba(255,255,255,0.04)",
    },
    loginLine: {
        marginTop:  28,
        fontSize:   14,
        color:      "rgba(255,255,255,0.55)",
    },
    loginLink: {
        color:          BRAND.accent,
        fontWeight:     700,
        textDecoration: "none",
    },
    footer: {
        marginTop: 16,
        fontSize:  12,
        color:     "rgba(255,255,255,0.30)",
    },
};
