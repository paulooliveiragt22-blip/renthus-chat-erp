// app/(admin)/configuracoes/page.tsx
"use client";

import React, { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { parseCardExpiry, pagarmeCreateCardToken } from "@/lib/pagarme/cardTokenBrowser";
import { lookupCep } from "@/lib/address/cepLookup";
import {
    BadgeCheck,
    Bike,
    Bot,
    Building2,
    CreditCard,
    Loader2,
    Lock,
    Mail,
    MapPin,
    Package,
    Phone,
    Receipt,
    Save,
    Shield,
    ShieldAlert,
    Store,
    Truck,
    Users,
    Wallet,
    CircleDollarSign,
    CalendarClock,
    BookOpen,
} from "lucide-react";
import MenuCardapioSettings from "@/components/menu/MenuCardapioSettings";
import MenuAnalyticsPanel from "@/components/menu/MenuAnalyticsPanel";
import MarketplaceIfoodSettings from "@/components/menu/MarketplaceIfoodSettings";
import MarketplaceAiqfomeSettings from "@/components/menu/MarketplaceAiqfomeSettings";
import MetaMessagingSettings from "@/components/menu/MetaMessagingSettings";
import MarketPlanGate from "@/components/menu/MarketPlanGate";
import ChatbotMessageTemplatesPanel from "@/components/menu/ChatbotMessageTemplatesPanel";
import TeamMembersPanel from "@/components/settings/TeamMembersPanel";
import StaffProfilesPanel from "@/components/settings/StaffProfilesPanel";
import ServiceFeesPanel from "@/components/settings/ServiceFeesPanel";
import { DEFAULT_CHATBOT_MESSAGE_TEMPLATES } from "@/lib/chatbot/messageTemplates";

// ─── types ────────────────────────────────────────────────────────────────────

type Company = {
    id: string;
    nome_fantasia: string | null;
    razao_social: string | null;
    cnpj: string | null;
    phone: string | null;
    email: string | null;
    whatsapp_phone: string | null;
    cep: string | null;
    endereco: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    delivery_fee_enabled: boolean;
    default_delivery_fee: number | null;
    settings: Record<string, unknown> | null;
};

type DeliveryRuleUi = {
    neighborhood: string;
    is_served: boolean;
    fee_override: string;
    min_order_override: string;
    eta_override_min: string;
    is_active: boolean;
};

type Tab = "geral" | "delivery" | "taxas" | "cardapio" | "plano" | "formas_pagamento" | "seguranca" | "chatbot" | "pedidos";

type BillingStatusJson = {
    ok?: boolean;
    error?: string;
    pagarme_subscription?: {
        plan:             string;
        status:           string;
        trial_ends_at:      string | null;
        next_billing_at:   string | null;
        last_paid_at:      string | null;
        activated_at:      string | null;
    } | null;
    pending_invoice?: {
        pagarme_payment_url: string | null;
        pix_qr_code:         string | null;
        amount:              number;
        due_at:              string;
    } | null;
    pending_setup_payment?: {
        pagarme_payment_url: string | null;
        amount:              number;
    } | null;
    invoice_history?: Array<{
        id:         string;
        amount:     number;
        status:     string;
        due_at:     string;
        paid_at:    string | null;
        created_at: string;
    }>;
    saved_cards?: Array<{
        id:        string;
        brand:     string;
        last_four: string;
        holder:    string;
        exp:       string;
        status:    string;
    }>;
    plan_key?: string | null;
    plan_label?: string | null;
    monthly_prices_brl?: {
        essencial?: number;
        pro?: number;
        market?: number;
        bot?: number;
        complete?: number;
    };
    setup_prices_brl?: {
        essencial?: number;
        pro?: number;
        market?: number;
        bot?: number;
        complete?: number;
    };
    enabled_features?: string[];
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function Field({
    label, value, onChange, placeholder = "", type = "text", hint,
}: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string; hint?: string;
}) {
    const id = useId();
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</label>
            <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {hint && <p className="text-[11px] text-zinc-400">{hint}</p>}
        </div>
    );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                checked ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"
            }`}
        >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
        </button>
    );
}

function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel = "Cancelar",
    onCancel,
    onConfirm,
}: {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
                {description && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{description}</p>}
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                        {confirmLabel ?? "Confirmar"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SectionTitle({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc?: string }) {
    return (
        <div className="flex items-center gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Icon className="h-4.5 w-4.5 h-[18px] w-[18px] text-violet-600" />
            </span>
            <div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</p>
                {desc && <p className="text-xs text-zinc-400">{desc}</p>}
            </div>
        </div>
    );
}

/** Medidor visual de crédito IA (sem R$) — estilo slider roxo. */
function AiCreditUsageMeter({
    remainingTotalCents,
    includedBudgetCents,
    prepaidBalanceCents,
}: {
    remainingTotalCents: number;
    includedBudgetCents: number;
    prepaidBalanceCents: number;
}) {
    const capacity = Math.max(
        includedBudgetCents + prepaidBalanceCents,
        remainingTotalCents,
        1
    );
    const ratio = Math.min(1, Math.max(0, remainingTotalCents / capacity));
    const pct = Math.round(ratio * 100);
    const thumbLeft = `calc(${pct}% - 8px)`;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Uso da IA</p>
                <p className="text-xs font-bold text-violet-700 dark:text-violet-300">{pct}% disponível</p>
            </div>
            <div className="relative h-3 w-full">
                <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                <div
                    className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-violet-600"
                    style={{ width: `${pct}%` }}
                />
                <div
                    className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-violet-600 shadow-sm ring-2 ring-white dark:ring-zinc-900"
                    style={{ left: thumbLeft }}
                    aria-hidden
                />
            </div>
            <div className="flex justify-between text-[10px] text-zinc-400">
                <span>0 esgotado</span>
                <span>1.0 cheio</span>
            </div>
            <p className="text-[11px] text-zinc-400">
                Incluso do mês + packs. Sem crédito a IA cai para Flow/catálogo.
            </p>
        </div>
    );
}

function SaveBar({ saving, msg, onSave }: { saving: boolean; msg: string | null; onSave: () => void }) {
    return (
        <div className="flex items-center justify-between border-t border-zinc-100 pt-5 dark:border-zinc-800">
            {msg ? (
                <p className={`text-xs font-medium ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</p>
            ) : (
                <span />
            )}
            <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
            >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Salvando…" : "Salvar alterações"}
            </button>
        </div>
    );
}

// ─── payment methods config ───────────────────────────────────────────────────

const PAGARME_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY ?? "";

type RenthusCardForm = { number: string; exp: string; cvv: string; holder: string };
type RenthusBillingAddr = { cep: string; endereco: string; numero: string; bairro: string; cidade: string; uf: string };

/** Retorna mensagem de erro ou dados prontos para token + checkout. */
function validateRenthusCardCheckout(
    renthusCard: RenthusCardForm,
    cardAddr: RenthusBillingAddr,
    nomeFantasia: string
): { error: string } | { exp: { month: string; year: string }; num: string; cvv: string; holder: string; addrCep: string } {
    const exp = parseCardExpiry(renthusCard.exp);
    if (!exp) return { error: "Validade do cartão: use MM/AA." };
    const num = renthusCard.number.replaceAll(/\D/g, "");
    if (num.length < 13) return { error: "Número do cartão inválido." };
    const cvv = renthusCard.cvv.replaceAll(/\D/g, "");
    if (cvv.length < 3) return { error: "CVV inválido." };
    const holder = renthusCard.holder.trim() || nomeFantasia.trim();
    if (holder.length < 3) {
        return { error: "Informe o nome no cartão ou preencha o nome fantasia na aba Geral." };
    }
    const addrCep = cardAddr.cep.replaceAll(/\D/g, "");
    if (!cardAddr.endereco.trim() || !cardAddr.numero.trim() || !cardAddr.cidade.trim() || cardAddr.uf.length < 2) {
        return { error: "Preencha o endereço de cobrança (CEP, endereço, número, cidade e UF)." };
    }
    if (addrCep.length < 8) {
        return { error: "CEP completo (8 dígitos) é obrigatório para pagamento com cartão." };
    }
    return { exp, num, cvv, holder, addrCep };
}

const ALL_PAYMENTS = [
    { key: "pix",          label: "Pix",          desc: "Transferência instantânea" },
    { key: "credit_card",  label: "Cartão de Crédito", desc: "Visa, Master, Elo, etc." },
    { key: "debit_card",   label: "Cartão de Débito",  desc: "Débito na maquininha" },
    { key: "cash",         label: "Dinheiro",     desc: "Pagamento em espécie" },
    { key: "voucher",      label: "Vale Refeição", desc: "Ticket, Sodexo, Alelo" },
];

// ─── main component ───────────────────────────────────────────────────────────

const TAB_QUERY_MAP: Record<string, Tab> = {
    plano:              "plano",
    pagamentos:         "plano",
    cobranca:           "plano",
    formas_pagamento:   "formas_pagamento",
    formas:             "formas_pagamento",
    geral:              "geral",
    delivery:           "delivery",
    taxas:              "taxas",
    taxa:               "taxas",
    cardapio:           "cardapio",
    menu:               "cardapio",
    seguranca:          "seguranca",
    chatbot:            "chatbot",
    pedidos:            "pedidos",
};

function ConfiguracoesPageContent() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const { currentCompanyId: companyId } = useWorkspace();

    const [activeTab, setActiveTab] = useState<Tab>("geral");
    const [loading, setLoading]     = useState(true);
    const [company, setCompany]     = useState<Company | null>(null);

    // ── form states ───────────────────────────────────────────────────────────
    const [nomeFantasia,     setNomeFantasia]     = useState("");
    const [razaoSocial,      setRazaoSocial]      = useState("");
    const [cnpj,             setCnpj]             = useState("");
    const [phone,            setPhone]            = useState("");
    const [email,            setEmail]            = useState("");
    const [whatsappPhone,    setWhatsappPhone]    = useState("");
    const [cep,              setCep]              = useState("");
    const [endereco,         setEndereco]         = useState("");
    const [numero,           setNumero]           = useState("");
    const [bairro,           setBairro]           = useState("");
    const [cidade,           setCidade]           = useState("");
    const [uf,               setUf]               = useState("");

    // delivery
    const [deliveryEnabled,  setDeliveryEnabled]  = useState(false);
    const [deliveryFee,      setDeliveryFee]      = useState("0");
    const [freeAbove,        setFreeAbove]        = useState("");
    const [minOrder,         setMinOrder]         = useState("");
    const [deliveryRadius,   setDeliveryRadius]   = useState("");
    const [estTime,          setEstTime]          = useState("");
    const [serviceByZone,    setServiceByZone]    = useState(false);
    const [serviceCity,      setServiceCity]      = useState("");
    const [serviceState,     setServiceState]     = useState("");
    const [zoneMode,         setZoneMode]         = useState<"all_city" | "allow_list" | "deny_list">("all_city");
    const [cityNeighborhoods, setCityNeighborhoods] = useState<string[]>([]);
    const [ruleDraft,        setRuleDraft]        = useState<DeliveryRuleUi[]>([]);
    const [customNeighborhood, setCustomNeighborhood] = useState("");
    const [deliveryPolicyMsg, setDeliveryPolicyMsg] = useState<string | null>(null);
    const [deliveryPolicyLoading, setDeliveryPolicyLoading] = useState(false);
    const [acceptDeliveries, setAcceptDeliveries] = useState(true);
    const [acceptPickup, setAcceptPickup] = useState(true);
    const [openTime, setOpenTime] = useState("08:00");
    const [closeTime, setCloseTime] = useState("22:00");
    const [openTime2, setOpenTime2] = useState("");
    const [closeTime2, setCloseTime2] = useState("");
    const [hoursConfigured, setHoursConfigured] = useState(false);
    const [storeTimezone, setStoreTimezone] = useState("America/Cuiaba");
    const [deliveryDescription, setDeliveryDescription] = useState("");
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [pendingDeleteNeighborhood, setPendingDeleteNeighborhood] = useState<string | null>(null);

    // pagamentos
    const [enabledPayments,  setEnabledPayments]  = useState<Record<string, boolean>>({
        pix: true, credit_card: true, debit_card: true, cash: true, voucher: false,
    });

    // segurança (informativo — não salva senha aqui)
    const [saving, setSaving] = useState(false);
    const [msg,    setMsg]    = useState<string | null>(null);
    const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // chatbot config
    const [chatbotId,       setChatbotId]       = useState<string | null>(null);
    const [msgWelcomeReturning, setMsgWelcomeReturning] = useState(
        DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_welcome_returning
    );
    const [msgWelcomeFirst, setMsgWelcomeFirst] = useState(
        DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_welcome_first
    );
    const [msgOutForDelivery, setMsgOutForDelivery] = useState(
        DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_out_for_delivery
    );
    const [msgThankYou, setMsgThankYou] = useState(
        DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_thank_you
    );
    const [aiEnabled, setAiEnabled] = useState(true);
    const [aiOrderMode, setAiOrderMode] = useState<"close_orders" | "info_only">("close_orders");
    const [sessionIdleMinutes, setSessionIdleMinutes] = useState("120");
    const [aiSessionWindowMinutes, setAiSessionWindowMinutes] = useState("60");
    const [aiMaxTurnsPerSession, setAiMaxTurnsPerSession] = useState("0");
    const [highValueConfirmEnabled, setHighValueConfirmEnabled] = useState(false);
    const [highValueConfirmAmount, setHighValueConfirmAmount] = useState("150");
    const [aiWallet, setAiWallet] = useState<{
        remainingTotalCents: number;
        remainingIncludedCents: number;
        prepaidBalanceCents: number;
        includedBudgetCents: number;
        autoRechargeEnabled: boolean;
        autoRechargePackCents: number | null;
    } | null>(null);
    const [aiPackLoading, setAiPackLoading] = useState<number | null>(null);
    const [aiPackPix, setAiPackPix] = useState<{
        code: string | null;
        url: string | null;
        amountBrl: number | null;
    } | null>(null);
    const [aiPackCopied, setAiPackCopied] = useState(false);
    const [botSaving,       setBotSaving]        = useState(false);
    const [botMsg,          setBotMsg]           = useState<string | null>(null);
    const botMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // company_settings (pedidos)
    const [requireApproval, setRequireApproval] = useState(false);
    const [autoPrint,       setAutoPrint]       = useState(false);
    const [settingsSaving,  setSettingsSaving]  = useState(false);
    const [settingsMsg,     setSettingsMsg]     = useState<string | null>(null);
    const settingsMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // company_settings (motor de IA — aba Chatbot, salvo junto com saveChatbot)
    const [llmProvider, setLlmProvider] = useState<"anthropic" | "openai">("anthropic");

    const [billingLoading, setBillingLoading]     = useState(false);
    const [billingData,    setBillingData]        = useState<BillingStatusJson | null>(null);
    const [billingErr,     setBillingErr]         = useState<string | null>(null);
    const [planSaving,     setPlanSaving]         = useState(false);
    const [pixLoading,     setPixLoading]         = useState(false);
    const [pixCopied,      setPixCopied]          = useState(false);
    const [renthusPayMode, setRenthusPayMode]     = useState<"pix" | "card">("pix");
    const [renthusCard,    setRenthusCard]        = useState({
        holder: "",
        number: "",
        exp:    "",
        cvv:    "",
    });
    const [renthusInstallments, setRenthusInstallments] = useState(1);
    const [cardPayLoading, setCardPayLoading]     = useState(false);
    const [billingSuccessMsg, setBillingSuccessMsg] = useState<string | null>(null);
    const [cardAddr, setCardAddr] = useState({ cep: "", endereco: "", numero: "", bairro: "", cidade: "", uf: "" });
    const [cepLoading, setCepLoading] = useState(false);

    // ── load company ──────────────────────────────────────────────────────────
    const loadCompany = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const res = await fetch("/api/companies/update");
        if (res.ok) {
            const json = await res.json();
            const c: Company = json.company;
            setCompany(c);
            setNomeFantasia(c.nome_fantasia ?? "");
            setRazaoSocial(c.razao_social ?? "");
            setCnpj(c.cnpj ?? "");
            setPhone(c.phone ?? "");
            setEmail(c.email ?? "");
            setWhatsappPhone(c.whatsapp_phone ?? "");
            setCep(c.cep ?? "");
            setEndereco(c.endereco ?? "");
            setNumero(c.numero ?? "");
            setBairro(c.bairro ?? "");
            setCidade(c.cidade ?? "");
            setUf(c.uf ?? "");
            setCardAddr({
                cep:      c.cep ?? "",
                endereco: c.endereco ?? "",
                numero:   c.numero ?? "",
                bairro:   c.bairro ?? "",
                cidade:   c.cidade ?? "",
                uf:       c.uf ?? "",
            });
            setDeliveryEnabled(!!c.delivery_fee_enabled);
            setDeliveryFee(c.default_delivery_fee != null ? String(c.default_delivery_fee) : "0");

            const s = c.settings ?? {};
            setFreeAbove(String(s.delivery_free_above ?? ""));
            setMinOrder(String(s.delivery_min_order ?? ""));
            setDeliveryRadius(String(s.delivery_radius_km ?? ""));
            setEstTime(String(s.delivery_est_minutes ?? ""));
            if (s.enabled_payments && typeof s.enabled_payments === "object") {
                setEnabledPayments((prev) => ({ ...prev, ...(s.enabled_payments as Record<string, boolean>) }));
            }
        }
        setLoading(false);
    }, [companyId]);

    useEffect(() => { loadCompany(); }, [loadCompany]);

    const loadDeliveryPolicy = useCallback(async () => {
        if (!companyId) return;
        setDeliveryPolicyLoading(true);
        setDeliveryPolicyMsg(null);
        try {
            const res = await fetch("/api/delivery/policy", { cache: "no-store", credentials: "include" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setDeliveryPolicyMsg(json?.error ?? "Erro ao carregar política de entrega.");
                return;
            }
            const p = json.policy ?? {};
            const city = String(p.service_city ?? json.company?.cidade ?? "");
            const state = String(p.service_state ?? json.company?.uf ?? "");
            setServiceCity(city);
            setServiceState(state);
            setServiceByZone(Boolean(p.service_by_zone));
            const mode = String(p.default_mode ?? "all_city");
            setZoneMode(mode === "allow_list" || mode === "deny_list" ? mode : "all_city");
            setAcceptDeliveries(p.deliveries_enabled !== false);
            setAcceptPickup(p.pickup_enabled !== false);
            setCityNeighborhoods(Array.isArray(json.city_neighborhoods) ? json.city_neighborhoods as string[] : []);
            const mapped: DeliveryRuleUi[] = (Array.isArray(json.rules) ? json.rules : []).map((r: Record<string, unknown>) => ({
                neighborhood: String(r.neighborhood ?? ""),
                is_served: Boolean(r.is_served),
                fee_override: r.fee_override != null ? String(r.fee_override) : "",
                min_order_override: r.min_order_override != null ? String(r.min_order_override) : "",
                eta_override_min: r.eta_override_min != null ? String(r.eta_override_min) : "",
                is_active: r.is_active !== false,
            }));
            setRuleDraft(mapped);

            const settingsRes = await fetch("/api/admin/company-settings", {
                cache: "no-store",
                credentials: "include",
            });
            const settingsJson = await settingsRes.json().catch(() => ({}));
            const s = settingsJson?.settings;
            if (s) {
                const periods = Array.isArray(s.opening_periods) ? s.opening_periods : [];
                const p0 = periods[0] as { open?: string; close?: string } | undefined;
                const p1 = periods[1] as { open?: string; close?: string } | undefined;
                setOpenTime(
                    (typeof p0?.open === "string" && p0.open) ||
                        (typeof s.open_time === "string" && s.open_time) ||
                        "08:00"
                );
                setCloseTime(
                    (typeof p0?.close === "string" && p0.close) ||
                        (typeof s.close_time === "string" && s.close_time) ||
                        "22:00"
                );
                setOpenTime2(typeof p1?.open === "string" ? p1.open : "");
                setCloseTime2(typeof p1?.close === "string" ? p1.close : "");
                setHoursConfigured(
                    periods.length > 0 ||
                        (typeof s.open_time === "string" && Boolean(s.open_time) &&
                            typeof s.close_time === "string" && Boolean(s.close_time))
                );
                setStoreTimezone(
                    typeof s.timezone === "string" && s.timezone.trim()
                        ? s.timezone
                        : "America/Cuiaba"
                );
                setDeliveryDescription(
                    typeof s.delivery_description === "string" ? s.delivery_description : ""
                );
            }
        } finally {
            setDeliveryPolicyLoading(false);
        }
    }, [companyId]);

    useEffect(() => { loadDeliveryPolicy().catch(() => {}); }, [loadDeliveryPolicy]);

    async function refreshNeighborhoodsFromIbge() {
        if (!serviceCity.trim()) {
            setDeliveryPolicyMsg("Preencha a cidade de atendimento para carregar bairros.");
            return;
        }
        const stateQ = serviceState.trim();
        const q = new URLSearchParams({
            city: serviceCity.trim(),
            ...(stateQ ? { state: stateQ } : {}),
            refresh: "1",
        });
        const res = await fetch(`/api/delivery/neighborhoods?${q.toString()}`, { cache: "no-store", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setDeliveryPolicyMsg(json?.error ?? "Erro ao atualizar bairros da cidade.");
            return;
        }
        const neighborhoods = Array.isArray(json.neighborhoods) ? json.neighborhoods as string[] : [];
        setCityNeighborhoods(neighborhoods);
        setDeliveryPolicyMsg(neighborhoods.length ? "Bairros atualizados." : "Nenhum bairro encontrado para a cidade informada.");
    }

    function upsertNeighborhoodRule(neighborhood: string, served: boolean) {
        const label = neighborhood.trim();
        if (!label) return;
        setRuleDraft((prev) => {
            const idx = prev.findIndex((r) => r.neighborhood.toLowerCase() === label.toLowerCase());
            if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], is_served: served, is_active: true };
                return next;
            }
            return [...prev, {
                neighborhood: label,
                is_served: served,
                fee_override: "",
                min_order_override: "",
                eta_override_min: "",
                is_active: true,
            }];
        });
    }

    function requestDeleteNeighborhood(neighborhood: string) {
        setPendingDeleteNeighborhood(neighborhood);
        setConfirmDeleteOpen(true);
    }

    function confirmDeleteNeighborhood() {
        const n = pendingDeleteNeighborhood;
        if (!n) return;
        setRuleDraft((prev) => prev.filter((r) => r.neighborhood.toLowerCase() !== n.toLowerCase()));
        setConfirmDeleteOpen(false);
        setPendingDeleteNeighborhood(null);
    }

    async function saveDeliveryPolicy() {
        setSaving(true);
        setDeliveryPolicyMsg(null);
        const parsedRules = ruleDraft.map((r) => ({
            neighborhood: r.neighborhood,
            is_served: r.is_served,
            fee_override: r.fee_override.trim() ? Number(r.fee_override) : null,
            min_order_override: r.min_order_override.trim() ? Number(r.min_order_override) : null,
            eta_override_min: r.eta_override_min.trim() ? Number(r.eta_override_min) : null,
            is_active: r.is_active,
        }));
        const res = await fetch("/api/delivery/policy", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                service_city: serviceCity.trim(),
                service_state: serviceState.trim().toUpperCase(),
                service_by_zone: serviceByZone,
                default_mode: zoneMode,
                rules: parsedRules,
                delivery_fee_enabled: deliveryEnabled,
                default_delivery_fee: Number(deliveryFee) || 0,
                delivery_min_order: minOrder ? Number(minOrder) : null,
                delivery_radius_km: deliveryRadius ? Number(deliveryRadius) : null,
                delivery_est_minutes: estTime ? Number(estTime) : null,
                delivery_free_above: freeAbove ? Number(freeAbove) : null,
                deliveries_enabled: acceptDeliveries,
                pickup_enabled: acceptPickup,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setDeliveryPolicyMsg(json?.error ?? "Erro ao salvar política de entrega.");
            setSaving(false);
            return;
        }

        const hoursRes = await fetch("/api/admin/company-settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                opening_periods: [
                    { open: openTime.trim(), close: closeTime.trim() },
                    ...(openTime2.trim() && closeTime2.trim()
                        ? [{ open: openTime2.trim(), close: closeTime2.trim() }]
                        : []),
                ],
                timezone: storeTimezone.trim() || "America/Cuiaba",
                delivery_description: deliveryDescription.trim() || null,
            }),
        });
        const hoursJson = await hoursRes.json().catch(() => ({}));
        if (!hoursRes.ok) {
            setDeliveryPolicyMsg(hoursJson?.error ?? "Política salva, mas falhou ao salvar horário.");
            setSaving(false);
            return;
        }

        setDeliveryPolicyMsg("✓ Política de entrega salva.");
        setSaving(false);
        await loadCompany();
        await loadDeliveryPolicy();
    }

    useEffect(() => {
        const raw = searchParams.get("tab")?.trim().toLowerCase();
        if (!raw) return;
        const next = TAB_QUERY_MAP[raw];
        if (next) setActiveTab(next);
    }, [searchParams]);

    const loadBilling = useCallback(async () => {
        if (!companyId) return;
        setBillingLoading(true);
        setBillingErr(null);
        try {
            const res = await fetch("/api/billing/status", { credentials: "include", cache: "no-store" });
            const json = (await res.json()) as BillingStatusJson;
            if (!res.ok) {
                setBillingErr(json.error ?? "Não foi possível carregar a cobrança.");
                setBillingData(null);
                return;
            }
            setBillingData(json);
        } catch {
            setBillingErr("Erro de rede ao carregar cobrança.");
            setBillingData(null);
        } finally {
            setBillingLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        if (activeTab === "plano" && companyId) {
            loadBilling().catch(() => {});
        }
    }, [activeTab, companyId, loadBilling]);

    async function changeRenthusPlan(plan: "essencial" | "pro" | "market") {
        setPlanSaving(true);
        setBillingErr(null);
        try {
            const res = await fetch("/api/billing/change-plan", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ plan }),
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Não foi possível alterar o plano.");
                return;
            }
            await loadBilling();
        } catch {
            setBillingErr("Erro de rede.");
        } finally {
            setPlanSaving(false);
        }
    }

    async function fetchViaCep(rawCep: string) {
        const digits = rawCep.replaceAll(/\D/g, "");
        if (digits.length !== 8) return;
        setCepLoading(true);
        try {
            const data = await lookupCep(digits, 3000);
            if (!data) return;
            setCardAddr((prev) => ({
                ...prev,
                cep: data.cep,
                endereco: data.logradouro || prev.endereco,
                bairro: data.bairro || prev.bairro,
                cidade: data.localidade || prev.cidade,
                uf: data.uf || prev.uf,
            }));
        } finally {
            setCepLoading(false);
        }
    }

    async function openRenthusPix() {
        setPixLoading(true);
        setBillingErr(null);
        setBillingSuccessMsg(null);
        setPixCopied(false);
        try {
            const res = await fetch("/api/billing/create-invoice-checkout", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ payment_method: "pix" }),
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Erro ao gerar PIX.");
                return;
            }
            if (json.pix_qr_code || json.pix_qr_url) {
                await loadBilling();
                setBillingSuccessMsg("PIX gerado. Após o pagamento no banco, o plano é liberado automaticamente.");
            } else {
                setBillingErr("PIX não retornado. Tente novamente ou fale com o suporte.");
            }
        } catch {
            setBillingErr("Erro de conexão.");
        } finally {
            setPixLoading(false);
        }
    }

    async function payRenthusCard() {
        setBillingErr(null);
        setBillingSuccessMsg(null);
        if (!PAGARME_PUBLIC_KEY) {
            setBillingErr("Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY e cadastre o domínio no Pagar.me.");
            return;
        }
        const validated = validateRenthusCardCheckout(renthusCard, cardAddr, nomeFantasia);
        if ("error" in validated) {
            setBillingErr(validated.error);
            return;
        }
        const { exp, num, cvv, holder, addrCep } = validated;

        setCardPayLoading(true);
        try {
            let cardToken: string;
            try {
                cardToken = await pagarmeCreateCardToken(PAGARME_PUBLIC_KEY, {
                    number:          num,
                    holder_name:     holder,
                    exp_month:       exp.month,
                    exp_year:        exp.year,
                    cvv,
                    holder_document: cnpj.replaceAll(/\D/g, "") || undefined,
                    billing_address: {
                        street:       cardAddr.endereco.trim(),
                        number:       cardAddr.numero.trim(),
                        neighborhood: cardAddr.bairro.trim(),
                        zipcode:      addrCep,
                        city:         cardAddr.cidade.trim(),
                        state:        cardAddr.uf.trim().toUpperCase().slice(0, 2),
                        country:      "BR",
                    },
                });
            } catch (e) {
                setBillingErr(e instanceof Error ? e.message : "Cartão recusado.");
                return;
            }

            const res = await fetch("/api/billing/create-invoice-checkout", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payment_method: "credit_card",
                    card_token:     cardToken,
                    installments:   renthusInstallments,
                    billing_address: {
                        cep:      addrCep,
                        endereco: cardAddr.endereco.trim(),
                        numero:   cardAddr.numero.trim(),
                        bairro:   cardAddr.bairro.trim(),
                        cidade:   cardAddr.cidade.trim(),
                        uf:       cardAddr.uf.trim().toUpperCase().slice(0, 2),
                    },
                }),
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setBillingErr((json as { error?: string }).error ?? "Erro ao processar cartão.");
                return;
            }
            const status = (json as { payment_status?: string; message?: string }).payment_status;
            const msg    = (json as { message?: string }).message;
            await loadBilling();
            if (status === "paid") {
                setBillingSuccessMsg(msg ?? "Pagamento aprovado. Plano liberado.");
            } else {
                setBillingSuccessMsg(
                    msg ??
                        "Pagamento em análise. Quando aprovado, o plano será liberado automaticamente."
                );
            }
        } catch {
            setBillingErr("Erro de conexão.");
        } finally {
            setCardPayLoading(false);
        }
    }

    // ── load chatbot config ───────────────────────────────────────────────────
    useEffect(() => {
        fetch("/api/chatbot/config", { credentials: "include", cache: "no-store" })
            .then((r) => r.json())
            .then((json) => {
                const cb = json?.chatbot;
                if (!cb) return;
                setChatbotId(cb.id);
                const cfg = cb.config ?? {};
                const mt = json?.messageTemplates ?? DEFAULT_CHATBOT_MESSAGE_TEMPLATES;
                setMsgWelcomeReturning(
                    mt.msg_welcome_returning ?? DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_welcome_returning
                );
                setMsgWelcomeFirst(
                    mt.msg_welcome_first ?? DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_welcome_first
                );
                setMsgOutForDelivery(
                    mt.msg_out_for_delivery ?? DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_out_for_delivery
                );
                setMsgThankYou(mt.msg_thank_you ?? DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_thank_you);
                setAiEnabled(json?.aiEnabled !== false);
                setAiOrderMode(json?.aiOrderMode === "info_only" ? "info_only" : "close_orders");
                if (json?.sessionIdleMinutes != null) {
                    setSessionIdleMinutes(String(json.sessionIdleMinutes));
                }
                if (json?.aiSessionWindowMinutes != null) {
                    setAiSessionWindowMinutes(String(json.aiSessionWindowMinutes));
                }
                if (json?.aiMaxTurnsPerSession != null) {
                    setAiMaxTurnsPerSession(String(json.aiMaxTurnsPerSession));
                }
                setHighValueConfirmEnabled(Boolean(json?.highValueConfirmEnabled));
                if (json?.highValueConfirmAmountBrl) {
                    setHighValueConfirmAmount(String(json.highValueConfirmAmountBrl));
                }
            })
            .catch(() => {});
        fetch("/api/admin/ai-wallet", { credentials: "include", cache: "no-store" })
            .then((r) => r.json())
            .then((json) => {
                if (json?.wallet) setAiWallet(json.wallet);
            })
            .catch(() => {});
    }, []);

    // ── load / save company_settings ──────────────────────────────────────────
    useEffect(() => {
        if (!companyId) return;
        fetch("/api/admin/company-settings", { cache: "no-store", credentials: "include" })
            .then((r) => r.json())
            .then((json) => {
                const data = json?.settings;
                if (!data) return;
                setRequireApproval(!!data.require_order_approval);
                setAutoPrint(!!data.auto_print_orders);
                setLlmProvider(data.llm_provider === "openai" ? "openai" : "anthropic");
            })
            .catch(() => {});
    }, [companyId, supabase]);

    async function saveOrderSettings() {
        if (!companyId) return;
        setSettingsSaving(true); setSettingsMsg(null);

        const res = await fetch("/api/admin/company-settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ require_order_approval: requireApproval, auto_print_orders: autoPrint }),
        });
        const json = await res.json().catch(() => ({}));
        setSettingsMsg(res.ok ? "✓ Configurações de pedidos salvas" : (json?.error ?? "Erro ao salvar"));
        setSettingsSaving(false);
        if (settingsMsgTimer.current) clearTimeout(settingsMsgTimer.current);
        settingsMsgTimer.current = setTimeout(() => setSettingsMsg(null), 4000);
    }

    async function saveChatbot() {
        if (!chatbotId) { setBotMsg("Nenhum chatbot encontrado para esta empresa."); return; }
        setBotSaving(true); setBotMsg(null);
        const [res, providerRes] = await Promise.all([
            fetch("/api/chatbot/config", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    id: chatbotId,
                    config: {
                        ai_enabled: aiEnabled,
                        ai_order_mode: aiOrderMode,
                        session_idle_minutes: Number(sessionIdleMinutes) || 120,
                        ai_session_window_minutes: Number(aiSessionWindowMinutes) || 60,
                        ai_max_turns_per_session:
                            aiOrderMode === "info_only" ? Number(aiMaxTurnsPerSession) || 0 : 0,
                        high_value_confirm_enabled: highValueConfirmEnabled,
                        high_value_confirm_amount_brl: Number(highValueConfirmAmount) || 0,
                    },
                    messageTemplates: {
                        msg_welcome_returning: msgWelcomeReturning,
                        msg_welcome_first: msgWelcomeFirst,
                        msg_out_for_delivery: msgOutForDelivery,
                        msg_thank_you: msgThankYou,
                    },
                }),
            }),
            // Motor de IA é por empresa (company_settings), não por bot — rota/RBAC próprias
            // (owner/admin, ver docs/PLANO_MULTI_PROVIDER_IA.md, Fase 8).
            fetch("/api/admin/company-settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ llm_provider: llmProvider }),
            }),
        ]);
        const json = await res.json().catch(() => ({}));
        const providerJson = await providerRes.json().catch(() => ({}));
        setBotMsg(
            res.ok && providerRes.ok
                ? "✓ Configurações do chatbot salvas"
                : (providerJson?.error ?? json?.error ?? "Erro ao salvar")
        );
        setBotSaving(false);
        if (botMsgTimer.current) clearTimeout(botMsgTimer.current);
        botMsgTimer.current = setTimeout(() => setBotMsg(null), 4000);
    }

    // ── save ──────────────────────────────────────────────────────────────────
    async function save() {
        setSaving(true); setMsg(null);
        const settingsPatch = {
            ...(company?.settings ?? {}),
            delivery_free_above:  freeAbove   ? Number(freeAbove)      : null,
            delivery_min_order:   minOrder     ? Number(minOrder)       : null,
            delivery_radius_km:   deliveryRadius ? Number(deliveryRadius) : null,
            delivery_est_minutes: estTime      ? Number(estTime)        : null,
            enabled_payments: enabledPayments,
        };

        const res = await fetch("/api/companies/update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nome_fantasia:        nomeFantasia,
                razao_social:         razaoSocial,
                cnpj, phone, email,
                whatsapp_phone:       whatsappPhone,
                cep, endereco, numero, bairro, cidade, uf,
                delivery_fee_enabled: deliveryEnabled,
                default_delivery_fee: Number(deliveryFee) || 0,
                settings:             settingsPatch,
            }),
        });
        const json = await res.json().catch(() => ({}));
        setMsg(res.ok ? "✓ Configurações salvas com sucesso" : (json?.error ?? "Erro ao salvar"));
        setSaving(false);
        if (msgTimer.current) clearTimeout(msgTimer.current);
        msgTimer.current = setTimeout(() => setMsg(null), 4000);
    }

    // ── tabs config ───────────────────────────────────────────────────────────
    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: "geral",              label: "Geral",                 icon: Store },
        { id: "delivery",           label: "Delivery",              icon: Truck },
        { id: "taxas",              label: "Taxas",                 icon: Receipt },
        { id: "cardapio",           label: "Cardápio web",          icon: BookOpen },
        { id: "plano",              label: "Plano e pagamentos",    icon: CircleDollarSign },
        { id: "formas_pagamento",   label: "Formas de pagamentos",  icon: Wallet },
        { id: "seguranca",          label: "Segurança",             icon: Shield },
        { id: "chatbot",            label: "Chatbot",               icon: Bot },
        { id: "pedidos",            label: "Pedidos",               icon: Package },
    ];

    // ── render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Configurações</h1>
                <p className="mt-0.5 text-xs text-zinc-400">Gerencie os dados e preferências da sua empresa</p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
                {/* ── TAB SIDEBAR ───────────────────────────────────────────── */}
                <nav className="flex flex-row gap-1 overflow-x-auto pb-1 sm:w-48 sm:shrink-0 sm:flex-col sm:overflow-x-visible sm:pb-0">
                    {tabs.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                                activeTab === id
                                    ? "bg-violet-600 text-white shadow-sm"
                                    : "text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            }`}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            {label}
                        </button>
                    ))}
                </nav>

                {/* ── CONTENT ───────────────────────────────────────────────── */}
                <div className="flex-1 rounded-xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">

                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                        </div>
                    ) : (

                    <>
                    {/* ── ABA: GERAL ──────────────────────────────────────── */}
                    {activeTab === "geral" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={Building2} title="Dados da Empresa" desc="Informações exibidas nos cupons e comunicações" />

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Nome Fantasia"  value={nomeFantasia}  onChange={setNomeFantasia}  placeholder="Ex: Disk Bebidas Sorriso" />
                                <Field label="Razão Social"   value={razaoSocial}   onChange={setRazaoSocial}   placeholder="Ex: Bebidas Ltda" />
                                <Field label="CNPJ"           value={cnpj}          onChange={setCnpj}          placeholder="00.000.000/0001-00" />
                                <Field label="Telefone"       value={phone}         onChange={setPhone}         placeholder="(66) 9 9999-9999" type="tel" />
                                <Field label="E-mail"         value={email}         onChange={setEmail}         placeholder="contato@empresa.com.br" type="email" />
                                <Field label="WhatsApp"       value={whatsappPhone} onChange={setWhatsappPhone} placeholder="5566999999999" hint="Com código do país, sem espaços ou +." />
                            </div>

                            <SectionTitle icon={MapPin} title="Endereço" desc="Localização física do estabelecimento" />

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <Field label="CEP"      value={cep}      onChange={setCep}      placeholder="78890-000" />
                                <div className="sm:col-span-2">
                                    <Field label="Endereço"  value={endereco} onChange={setEndereco} placeholder="Rua, Av., Travessa…" />
                                </div>
                                <Field label="Número"  value={numero}  onChange={setNumero}  placeholder="123" />
                                <Field label="Bairro"  value={bairro}  onChange={setBairro}  placeholder="Centro" />
                                <Field label="Cidade"  value={cidade}  onChange={setCidade}  placeholder="Sorriso" />
                                <Field label="UF"      value={uf}      onChange={setUf}      placeholder="MT" />
                            </div>

                            <SaveBar saving={saving} msg={msg} onSave={save} />

                            <SectionTitle
                                icon={Users}
                                title="Equipe e permissões"
                                desc="Perfis de acesso e colaboradores (somente proprietário e administrador)"
                            />
                            <StaffProfilesPanel />
                            <TeamMembersPanel />
                        </div>
                    )}

                    {/* ── ABA: DELIVERY ─────────────────────────────────── */}
                    {activeTab === "delivery" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={Bike} title="Configurações de Delivery" desc="Cidade atendida, bairros, taxas, horário e estimativa de entrega" />

                            {!hoursConfigured ? (
                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
                                    Nenhum horário gravado ainda. Até salvar, cardápio e WhatsApp ficam
                                    sempre abertos. Preencha 1 ou 2 turnos e salve esta aba.
                                </p>
                            ) : null}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field
                                    label="1º turno — abre"
                                    value={openTime}
                                    onChange={setOpenTime}
                                    type="time"
                                    placeholder="11:00"
                                    hint="Almoço ou único período. Fuso da loja abaixo."
                                />
                                <Field
                                    label="1º turno — fecha"
                                    value={closeTime}
                                    onChange={setCloseTime}
                                    type="time"
                                    placeholder="14:30"
                                />
                                <Field
                                    label="2º turno — abre (opcional)"
                                    value={openTime2}
                                    onChange={setOpenTime2}
                                    type="time"
                                    placeholder="18:00"
                                    hint="Jantar. Deixe vazio se a loja tem um só horário."
                                />
                                <Field
                                    label="2º turno — fecha (opcional)"
                                    value={closeTime2}
                                    onChange={setCloseTime2}
                                    type="time"
                                    placeholder="23:00"
                                />
                                <Field
                                    label="Fuso horário (IANA)"
                                    value={storeTimezone}
                                    onChange={setStoreTimezone}
                                    placeholder="America/Cuiaba"
                                    hint="Ex.: America/Cuiaba, America/Sao_Paulo. Turno 1 pode atravessar meia-noite (ex. 18:00–02:00)."
                                />
                            </div>
                            <label className="block">
                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                    Descrição do delivery
                                </span>
                                <textarea
                                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    rows={2}
                                    maxLength={280}
                                    value={deliveryDescription}
                                    onChange={(e) => setDeliveryDescription(e.target.value)}
                                    placeholder="Ex.: Entregamos até 3 km do centro. Pedido mínimo R$ 30."
                                />
                                <span className="mt-1 block text-xs text-zinc-400">
                                    {deliveryDescription.length}/280 — aparece no cardápio e ajuda o bot.
                                </span>
                            </label>

                            <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Aceitar entregas</p>
                                    <p className="text-xs text-zinc-400">Chatbot e cardápio web oferecem entrega com endereço</p>
                                </div>
                                <Toggle checked={acceptDeliveries} onChange={setAcceptDeliveries} />
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Aceitar retirada no local</p>
                                    <p className="text-xs text-zinc-400">Cliente retira na loja, sem taxa nem endereço de entrega</p>
                                </div>
                                <Toggle checked={acceptPickup} onChange={setAcceptPickup} />
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cobrar taxa de entrega</p>
                                    <p className="text-xs text-zinc-400">Só vale para pedidos de entrega — independente de aceitar ou não entregas</p>
                                </div>
                                <Toggle checked={deliveryEnabled} onChange={setDeliveryEnabled} />
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field
                                    label="Cidade de atendimento"
                                    value={serviceCity}
                                    onChange={setServiceCity}
                                    placeholder="Ex: Sorriso"
                                />
                                <Field
                                    label="UF"
                                    value={serviceState}
                                    onChange={setServiceState}
                                    placeholder="Ex: MT"
                                />
                                <Field
                                    label="Taxa de entrega padrão (R$)"
                                    value={deliveryFee}
                                    onChange={setDeliveryFee}
                                    placeholder="5.00"
                                    type="number"
                                    hint="Valor cobrado por padrão em novos pedidos."
                                />
                                <Field
                                    label="Frete grátis acima de (R$)"
                                    value={freeAbove}
                                    onChange={setFreeAbove}
                                    placeholder="Ex: 80.00 (deixe vazio para desativar)"
                                    type="number"
                                />
                                <Field
                                    label="Pedido mínimo (R$)"
                                    value={minOrder}
                                    onChange={setMinOrder}
                                    placeholder="Ex: 30.00"
                                    type="number"
                                />
                                <Field
                                    label="Raio de entrega (km)"
                                    value={deliveryRadius}
                                    onChange={setDeliveryRadius}
                                    placeholder="Ex: 10"
                                    type="number"
                                />
                                <Field
                                    label="Tempo estimado de entrega (min)"
                                    value={estTime}
                                    onChange={setEstTime}
                                    placeholder="Ex: 45"
                                    type="number"
                                    hint="Exibido ao cliente no chatbot ao confirmar o pedido."
                                />
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Atende por zona (bairro)?</p>
                                    <p className="text-xs text-zinc-400">
                                        Se desativado, atende a cidade inteira (usando taxa padrão).
                                    </p>
                                </div>
                                <Toggle checked={serviceByZone} onChange={setServiceByZone} />
                            </div>

                            {serviceByZone && (
                                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setZoneMode("allow_list")}
                                            className={`rounded-full px-3 py-1 text-xs font-semibold ${zoneMode === "allow_list" ? "bg-violet-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}
                                        >
                                            Só bairros atendidos
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setZoneMode("deny_list")}
                                            className={`rounded-full px-3 py-1 text-xs font-semibold ${zoneMode === "deny_list" ? "bg-violet-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}
                                        >
                                            Cidade toda, exceto bloqueados
                                        </button>
                                    </div>

                                    <div className="mb-3 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={refreshNeighborhoodsFromIbge}
                                            className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20"
                                        >
                                            Carregar bairros da cidade (IBGE)
                                        </button>
                                        <input
                                            value={customNeighborhood}
                                            onChange={(e) => setCustomNeighborhood(e.target.value)}
                                            placeholder="Adicionar bairro manualmente"
                                            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const n = customNeighborhood.trim();
                                                if (!n) return;
                                                setCityNeighborhoods((prev) => [...new Set([...prev, n])].sort((a, b) => a.localeCompare(b)));
                                                upsertNeighborhoodRule(n, zoneMode === "allow_list");
                                                setCustomNeighborhood("");
                                            }}
                                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                        >
                                            Adicionar
                                        </button>
                                    </div>

                                    <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                                        <p className="mb-2 text-xs font-semibold text-zinc-500">Bairros da cidade (chips)</p>
                                        <div className="flex flex-wrap gap-2">
                                            {cityNeighborhoods.map((n) => {
                                                const existing = ruleDraft.find((r) => r.neighborhood.toLowerCase() === n.toLowerCase());
                                                const served = existing ? existing.is_served : zoneMode !== "deny_list";
                                                return (
                                                    <div key={n} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700">
                                                        <span className={served ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>{n}</span>
                                                        <button type="button" onClick={() => upsertNeighborhoodRule(n, true)} className="rounded bg-emerald-100 px-1 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Atende</button>
                                                        <button type="button" onClick={() => upsertNeighborhoodRule(n, false)} className="rounded bg-red-100 px-1 text-red-700 dark:bg-red-900/30 dark:text-red-300">Não atende</button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {ruleDraft.length > 0 && (
                                        <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                                            <p className="mb-2 text-xs font-semibold text-zinc-500">Regras selecionadas</p>
                                            <div className="flex flex-col gap-2">
                                                {ruleDraft.map((r) => (
                                                    <div key={r.neighborhood} className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-100 p-2 sm:grid-cols-6 dark:border-zinc-800">
                                                        <div className="sm:col-span-2">
                                                            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{r.neighborhood}</p>
                                                            <p className={`text-[11px] ${r.is_served ? "text-emerald-600" : "text-red-600"}`}>{r.is_served ? "Atende" : "Não atende"}</p>
                                                        </div>
                                                        <input value={r.fee_override} onChange={(e) => setRuleDraft((prev) => prev.map((x) => x.neighborhood === r.neighborhood ? { ...x, fee_override: e.target.value } : x))} placeholder="Taxa" className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                                                        <input value={r.min_order_override} onChange={(e) => setRuleDraft((prev) => prev.map((x) => x.neighborhood === r.neighborhood ? { ...x, min_order_override: e.target.value } : x))} placeholder="Mínimo" className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                                                        <input value={r.eta_override_min} onChange={(e) => setRuleDraft((prev) => prev.map((x) => x.neighborhood === r.neighborhood ? { ...x, eta_override_min: e.target.value } : x))} placeholder="Min" className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                                                        <button type="button" onClick={() => requestDeleteNeighborhood(r.neighborhood)} className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20">
                                                            Excluir
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {deliveryPolicyLoading && <p className="text-xs text-zinc-500">Carregando política de entrega…</p>}
                            {deliveryPolicyMsg && <p className="text-xs text-zinc-500">{deliveryPolicyMsg}</p>}
                            <SaveBar saving={saving} msg={deliveryPolicyMsg ?? msg} onSave={saveDeliveryPolicy} />
                        </div>
                    )}

                    {activeTab === "taxas" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle
                                icon={Receipt}
                                title="Taxas"
                                desc="Taxa de entrega e demais taxas aplicadas nos pedidos"
                            />
                            <ServiceFeesPanel />
                        </div>
                    )}

                    {/* ── ABA: PLANO E PAGAMENTOS (RENTHUS) ─────────────── */}
                    {activeTab === "plano" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle
                                icon={CircleDollarSign}
                                title="Plano e pagamentos Lysthub"
                                desc="Período de teste, mensalidade, PIX e cartões salvos no Pagar.me"
                            />

                            {billingLoading && (
                                <div className="flex justify-center py-10">
                                    <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
                                </div>
                            )}

                            {!billingLoading && billingErr && (
                                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                                    {billingErr}
                                </div>
                            )}

                            {!billingLoading && billingData && (
                                <>
                                    {(() => {
                                        const sub = billingData.pagarme_subscription;
                                        const st  = sub?.status ?? "";
                                        const plan = sub?.plan ?? "";
                                        const trialEnd = sub?.trial_ends_at
                                            ? new Date(sub.trial_ends_at).toLocaleString("pt-BR", {
                                                  dateStyle: "medium",
                                                  timeStyle: "short",
                                              })
                                            : null;
                                        const nextBill = sub?.next_billing_at
                                            ? new Date(sub.next_billing_at).toLocaleString("pt-BR", {
                                                  dateStyle: "medium",
                                                  timeStyle: "short",
                                              })
                                            : null;
                                        const lastPaid = sub?.last_paid_at
                                            ? new Date(sub.last_paid_at).toLocaleString("pt-BR", {
                                                  dateStyle: "medium",
                                                  timeStyle: "short",
                                              })
                                            : null;

                                        const statusLabel =
                                            st === "trial"
                                                ? "Período de teste"
                                                : st === "active"
                                                  ? "Assinatura ativa"
                                                  : st === "overdue"
                                                    ? "Mensalidade em aberto"
                                                    : st === "blocked"
                                                      ? "Acesso suspenso"
                                                      : st || "—";

                                        return (
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                                        Situação
                                                    </p>
                                                    <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                                                        {statusLabel}
                                                    </p>
                                                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                                                        Plano atual:{" "}
                                                        <span className="font-semibold">
                                                            {billingData.plan_label ||
                                                                (plan === "market"
                                                                    ? "Market"
                                                                    : plan === "pro" ||
                                                                        plan === "complete"
                                                                      ? "Pro"
                                                                      : plan === "essencial" ||
                                                                          plan === "bot" ||
                                                                          plan === "starter"
                                                                        ? "Essencial"
                                                                        : plan || "—")}
                                                        </span>
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                                                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                                        <CalendarClock className="h-3.5 w-3.5" />
                                                        Datas
                                                    </p>
                                                    {st === "trial" && trialEnd && (
                                                        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                                                            Teste gratuito até{" "}
                                                            <span className="font-semibold">{trialEnd}</span>
                                                            . Depois disso você paga a mensalidade aqui (PIX ou cartão).
                                                        </p>
                                                    )}
                                                    {(st === "active" || st === "overdue") && nextBill && (
                                                        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                                                            Próxima cobrança prevista:{" "}
                                                            <span className="font-semibold">{nextBill}</span>
                                                        </p>
                                                    )}
                                                    {lastPaid && (
                                                        <p className="mt-1 text-xs text-zinc-500">
                                                            Último pagamento registrado: {lastPaid}
                                                        </p>
                                                    )}
                                                    {st === "trial" && !trialEnd && (
                                                        <p className="mt-2 text-sm text-zinc-500">Sem data de término do trial registrada.</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {(() => {
                                        const sub  = billingData.pagarme_subscription;
                                        const st   = sub?.status ?? "";
                                        const rawPlan = String(sub?.plan ?? billingData.plan_key ?? "");
                                        const pk =
                                            rawPlan === "market"
                                                ? ("market" as const)
                                                : rawPlan === "pro" || rawPlan === "complete"
                                                  ? ("pro" as const)
                                                  : ("essencial" as const);

                                        const isFirstPayment = st === "trial" || st === "pending_setup";
                                        const sp   = billingData.setup_prices_brl   ?? {};
                                        const mp   = billingData.monthly_prices_brl ?? {};

                                        // Pending record: setup_payment para primeiro pagamento, invoice para os demais
                                        const pendSetup   = billingData.pending_setup_payment;
                                        const pendInv     = billingData.pending_invoice;
                                        const pendRecord  = isFirstPayment ? pendSetup : pendInv;

                                        const priceFallback =
                                            pk === "market" ? 397 : pk === "pro" ? 279 : 197;

                                        let refAmount: number;
                                        if (pendRecord) {
                                            refAmount = Number(pendRecord.amount);
                                        } else if (isFirstPayment) {
                                            refAmount =
                                                (sp as Record<string, number | undefined>)[pk] ??
                                                priceFallback;
                                        } else {
                                            refAmount =
                                                (mp as Record<string, number | undefined>)[pk] ??
                                                priceFallback;
                                        }

                                        const pixUrl =
                                            pendRecord?.pagarme_payment_url?.startsWith("http")
                                                ? pendRecord.pagarme_payment_url
                                                : null;
                                        const pixCode =
                                            !isFirstPayment && billingData.pending_invoice
                                                ? (billingData.pending_invoice.pix_qr_code ?? "")
                                                : "";

                                        const showPay =
                                            st === "trial"         ||
                                            st === "pending_setup" ||
                                            st === "active"        ||
                                            st === "overdue"       ||
                                            st === "blocked";

                                        if (!showPay) return null;

                                        let pixButtonLabel = "Gerar código PIX";
                                        if (pixLoading) pixButtonLabel = "Gerando…";
                                        else if (pixUrl || pixCode) pixButtonLabel = "Gerar novo / atualizar PIX";

                                        return (
                                            <div className="rounded-2xl border-2 border-violet-300/70 bg-gradient-to-br from-violet-50 via-white to-zinc-50 p-5 shadow-sm dark:border-violet-800 dark:from-violet-950/30 dark:via-zinc-900 dark:to-zinc-950">
                                                {st === "blocked" && (
                                                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                                                        Acesso suspenso. Pague abaixo: cartão aprovado libera na hora;
                                                        PIX libera quando o banco confirmar.
                                                    </div>
                                                )}
                                                {st === "overdue" && (
                                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                                        Mensalidade em aberto. Escolha PIX ou cartão.
                                                    </div>
                                                )}
                                                {st === "pending_setup" && (
                                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                                        Taxa de ativação em aberto. Escolha PIX ou cartão para ativar.
                                                    </div>
                                                )}
                                                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                                                    {isFirstPayment ? "Ativar plano Lysthub" : "Pagar mensalidade Lysthub"}
                                                </h3>
                                                <p className="mt-0.5 text-xs text-zinc-500">
                                                    {isFirstPayment
                                                        ? "Taxa de ativação única — após o pagamento as mensalidades são cobradas a cada 30 dias."
                                                        : "Mensalidade recorrente. Próximo vencimento em 30 dias após o pagamento."}
                                                </p>
                                                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                                                    Valor:{" "}
                                                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {refAmount.toLocaleString("pt-BR", {
                                                            style:    "currency",
                                                            currency: "BRL",
                                                        })}
                                                    </span>
                                                    {pendRecord ? " · cobrança em aberto" : " · gerado ao confirmar"}
                                                </p>
                                                {pendInv?.due_at && !isFirstPayment && (
                                                    <p className="mt-0.5 text-xs text-zinc-500">
                                                        Vencimento:{" "}
                                                        {new Date(pendInv.due_at).toLocaleString("pt-BR", {
                                                            dateStyle: "medium",
                                                            timeStyle: "short",
                                                        })}
                                                    </p>
                                                )}

                                                {billingSuccessMsg && (
                                                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                                                        {billingSuccessMsg}
                                                    </div>
                                                )}

                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setRenthusPayMode("pix")}
                                                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                                            renthusPayMode === "pix"
                                                                ? "bg-violet-600 text-white"
                                                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                                                        }`}
                                                    >
                                                        PIX
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setRenthusPayMode("card")}
                                                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                                            renthusPayMode === "card"
                                                                ? "bg-violet-600 text-white"
                                                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                                                        }`}
                                                    >
                                                        Cartão de crédito
                                                    </button>
                                                </div>

                                                {renthusPayMode === "pix" && (
                                                    <div className="mt-4 space-y-4">
                                                        {(pixUrl || pixCode) && (
                                                            <div className="flex flex-wrap gap-3">
                                                                {pixUrl && (
                                                                    // eslint-disable-next-line @next/next/no-img-element
                                                                    <img
                                                                        src={pixUrl}
                                                                        alt="QR PIX"
                                                                        className="h-40 w-40 rounded-xl border border-zinc-200 bg-white object-contain p-1 dark:border-zinc-700"
                                                                    />
                                                                )}
                                                                {pixCode ? (
                                                                    <div className="min-w-[200px] flex-1">
                                                                        <textarea
                                                                            readOnly
                                                                            className="w-full rounded-lg border border-zinc-200 bg-white p-2 font-mono text-[10px] dark:border-zinc-600 dark:bg-zinc-900"
                                                                            rows={5}
                                                                            value={pixCode}
                                                                            onFocus={(e) => e.target.select()}
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            onClick={async () => {
                                                                                try {
                                                                                    await navigator.clipboard.writeText(
                                                                                        pixCode
                                                                                    );
                                                                                    setPixCopied(true);
                                                                                    setTimeout(
                                                                                        () => setPixCopied(false),
                                                                                        2000
                                                                                    );
                                                                                } catch {
                                                                                    setBillingErr(
                                                                                        "Não foi possível copiar."
                                                                                    );
                                                                                }
                                                                            }}
                                                                            className="mt-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900"
                                                                        >
                                                                            {pixCopied ? "Copiado!" : "Copiar PIX"}
                                                                        </button>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                openRenthusPix().catch(() => {});
                                                            }}
                                                            disabled={pixLoading}
                                                            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                                                        >
                                                            {pixButtonLabel}
                                                        </button>
                                                        <p className="text-xs text-zinc-500">
                                                            O plano é liberado automaticamente quando o pagamento for
                                                            confirmado pelo Pagar.me.
                                                        </p>
                                                    </div>
                                                )}

                                                {renthusPayMode === "card" && (
                                                    <div className="mt-4 space-y-3">
                                                        {!PAGARME_PUBLIC_KEY && (
                                                            <p className="text-xs text-amber-700 dark:text-amber-300">
                                                                Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY para pagar com
                                                                cartão.
                                                            </p>
                                                        )}
                                                        <div className="grid gap-3 sm:grid-cols-2">
                                                            <Field
                                                                label="Nome no cartão"
                                                                value={renthusCard.holder}
                                                                onChange={(v) =>
                                                                    setRenthusCard((c) => ({ ...c, holder: v }))
                                                                }
                                                                placeholder={nomeFantasia || "Como no cartão"}
                                                            />
                                                            <Field
                                                                label="Número"
                                                                value={renthusCard.number}
                                                                onChange={(v) =>
                                                                    setRenthusCard((c) => ({ ...c, number: v }))
                                                                }
                                                                placeholder="0000 0000 0000 0000"
                                                            />
                                                            <Field
                                                                label="Validade (MM/AA)"
                                                                value={renthusCard.exp}
                                                                onChange={(v) =>
                                                                    setRenthusCard((c) => ({ ...c, exp: v }))
                                                                }
                                                                placeholder="08/28"
                                                            />
                                                            <Field
                                                                label="CVV"
                                                                value={renthusCard.cvv}
                                                                onChange={(v) =>
                                                                    setRenthusCard((c) => ({ ...c, cvv: v }))
                                                                }
                                                                placeholder="123"
                                                                type="password"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label
                                                                htmlFor="renthus-installments"
                                                                className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                                                            >
                                                                Parcelas (valor da mensalidade)
                                                            </label>
                                                            <select
                                                                id="renthus-installments"
                                                                value={renthusInstallments}
                                                                onChange={(e) =>
                                                                    setRenthusInstallments(Number(e.target.value))
                                                                }
                                                                className="mt-1 w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                                                            >
                                                                {Array.from({ length: 12 }, (_, i) => i + 1).map(
                                                                    (n) => (
                                                                        <option key={n} value={n}>
                                                                            {n}x
                                                                        </option>
                                                                    )
                                                                )}
                                                            </select>
                                                        </div>
                                                        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                                                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                                                Endereço de cobrança
                                                            </p>
                                                            <div className="grid gap-3 sm:grid-cols-2">
                                                                <div className="flex flex-col gap-1">
                                                                    <label
                                                                        htmlFor="renthus-card-cep"
                                                                        className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                                                                    >
                                                                        CEP
                                                                    </label>
                                                                    <div className="flex gap-2">
                                                                        <input
                                                                            id="renthus-card-cep"
                                                                            type="text"
                                                                            value={cardAddr.cep}
                                                                            onChange={(e) =>
                                                                                setCardAddr((a) => ({ ...a, cep: e.target.value }))
                                                                            }
                                                                            onBlur={(e) => {
                                                                                fetchViaCep(e.target.value).catch(
                                                                                    () => {}
                                                                                );
                                                                            }}
                                                                            placeholder="00000-000"
                                                                            maxLength={9}
                                                                            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                                                        />
                                                                        {cepLoading && (
                                                                            <Loader2 className="mt-2 h-4 w-4 shrink-0 animate-spin text-violet-500" />
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <Field
                                                                    label="Número"
                                                                    value={cardAddr.numero}
                                                                    onChange={(v) =>
                                                                        setCardAddr((a) => ({ ...a, numero: v }))
                                                                    }
                                                                    placeholder="123"
                                                                />
                                                                <div className="sm:col-span-2">
                                                                    <Field
                                                                        label="Endereço (logradouro)"
                                                                        value={cardAddr.endereco}
                                                                        onChange={(v) =>
                                                                            setCardAddr((a) => ({ ...a, endereco: v }))
                                                                        }
                                                                        placeholder="Rua Exemplo"
                                                                    />
                                                                </div>
                                                                <Field
                                                                    label="Bairro"
                                                                    value={cardAddr.bairro}
                                                                    onChange={(v) =>
                                                                        setCardAddr((a) => ({ ...a, bairro: v }))
                                                                    }
                                                                    placeholder="Centro"
                                                                />
                                                                <Field
                                                                    label="Cidade"
                                                                    value={cardAddr.cidade}
                                                                    onChange={(v) =>
                                                                        setCardAddr((a) => ({ ...a, cidade: v }))
                                                                    }
                                                                    placeholder="São Paulo"
                                                                />
                                                                <Field
                                                                    label="UF"
                                                                    value={cardAddr.uf}
                                                                    onChange={(v) =>
                                                                        setCardAddr((a) => ({ ...a, uf: v.toUpperCase().slice(0, 2) }))
                                                                    }
                                                                    placeholder="SP"
                                                                />
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                payRenthusCard().catch(() => {});
                                                            }}
                                                            disabled={cardPayLoading}
                                                            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                                                        >
                                                            {cardPayLoading ? "Processando…" : "Pagar com cartão"}
                                                        </button>
                                                        <p className="text-xs text-zinc-500">
                                                            Aprovado na hora = plano liberado imediatamente. Em análise =
                                                            liberamos quando o banco confirmar (webhook).
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {billingData.pagarme_subscription?.status === "trial" && (
                                        <div>
                                            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-500">
                                                Escolha do plano (durante o teste)
                                            </p>
                                            <div className="grid gap-3 sm:grid-cols-3">
                                                {(
                                                    [
                                                        {
                                                            key: "essencial" as const,
                                                            name: "Essencial",
                                                            blurb: "WhatsApp + cardápio + IA",
                                                        },
                                                        {
                                                            key: "pro" as const,
                                                            name: "Pro",
                                                            blurb: "ERP + impressão + IA",
                                                            popular: true,
                                                        },
                                                        {
                                                            key: "market" as const,
                                                            name: "Market",
                                                            blurb: "Pro + iFood/Aiqfome + omni",
                                                        },
                                                    ] as const
                                                ).map((p) => {
                                                    const cur = String(
                                                        billingData.pagarme_subscription?.plan ?? ""
                                                    );
                                                    const active =
                                                        cur === p.key ||
                                                        (p.key === "essencial" &&
                                                            (cur === "bot" || cur === "starter")) ||
                                                        (p.key === "pro" && cur === "complete");
                                                    const mp = billingData.monthly_prices_brl ?? {};
                                                    const price =
                                                        (mp as Record<string, number>)[p.key] ??
                                                        (p.key === "essencial"
                                                            ? 197
                                                            : p.key === "pro"
                                                              ? 279
                                                              : 397);
                                                    return (
                                                        <div
                                                            key={p.key}
                                                            className={`rounded-xl border-2 p-4 ${
                                                                active
                                                                    ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
                                                                    : "border-zinc-200 dark:border-zinc-700"
                                                            }`}
                                                        >
                                                            {"popular" in p && p.popular ? (
                                                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-600">
                                                                    Mais popular
                                                                </p>
                                                            ) : null}
                                                            <p className="font-bold text-zinc-900 dark:text-zinc-100">
                                                                {p.name}
                                                            </p>
                                                            <p className="mt-0.5 text-xs text-zinc-500">
                                                                {p.blurb}
                                                            </p>
                                                            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                                                                {price.toLocaleString("pt-BR", {
                                                                    style: "currency",
                                                                    currency: "BRL",
                                                                })}
                                                                /mês
                                                            </p>
                                                            <button
                                                                type="button"
                                                                disabled={planSaving || active}
                                                                onClick={() => {
                                                                    changeRenthusPlan(p.key).catch(
                                                                        () => {}
                                                                    );
                                                                }}
                                                                className="mt-3 w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                                                            >
                                                                {active ? "Plano atual" : "Usar este plano"}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {(() => {
                                        const cur = String(
                                            billingData.pagarme_subscription?.plan ?? ""
                                        );
                                        const st = billingData.pagarme_subscription?.status;
                                        const paid = st === "active" || st === "overdue";
                                        if (!paid) return null;
                                        const isEssencial =
                                            cur === "essencial" || cur === "bot" || cur === "starter";
                                        const isPro = cur === "pro" || cur === "complete";
                                        const isMarket = cur === "market";
                                        const mp = billingData.monthly_prices_brl ?? {};
                                        if (isMarket) {
                                            return (
                                                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                                    Você já está no plano Market (máximo atual).
                                                </p>
                                            );
                                        }
                                        return (
                                            <div className="space-y-3">
                                                {isEssencial ? (
                                                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                                            Upgrade para Pro
                                                        </p>
                                                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                                            ERP completo + impressão automática (
                                                            {(
                                                                (mp as Record<string, number>).pro ??
                                                                279
                                                            ).toLocaleString("pt-BR", {
                                                                style: "currency",
                                                                currency: "BRL",
                                                            })}
                                                            /mês).
                                                        </p>
                                                        <button
                                                            type="button"
                                                            disabled={planSaving}
                                                            onClick={() => {
                                                                changeRenthusPlan("pro").catch(
                                                                    () => {}
                                                                );
                                                            }}
                                                            className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                                        >
                                                            {planSaving ? "Salvando…" : "Ir para Pro"}
                                                        </button>
                                                    </div>
                                                ) : null}
                                                {(isEssencial || isPro) && (
                                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                                            Upgrade para Market
                                                        </p>
                                                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                                            iFood + Aiqfome + Instagram/Messenger + mesa (
                                                            {(
                                                                (mp as Record<string, number>)
                                                                    .market ?? 397
                                                            ).toLocaleString("pt-BR", {
                                                                style: "currency",
                                                                currency: "BRL",
                                                            })}
                                                            /mês).
                                                        </p>
                                                        <button
                                                            type="button"
                                                            disabled={planSaving}
                                                            onClick={() => {
                                                                changeRenthusPlan("market").catch(
                                                                    () => {}
                                                                );
                                                            }}
                                                            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                                                        >
                                                            {planSaving
                                                                ? "Salvando…"
                                                                : "Ir para Market"}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    <SectionTitle
                                        icon={CreditCard}
                                        title="Formas de pagamento (cobrança Lysthub)"
                                        desc="Como você paga a mensalidade da plataforma — não confunde com formas aceitas no delivery"
                                    />
                                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            PIX e cartão
                                        </p>
                                        <p className="mt-1 text-xs text-zinc-500">
                                            Use o bloco &quot;Pagar mensalidade Lysthub&quot; acima: PIX (QR e copia e
                                            cola) ou cartão tokenizado no Pagar.me. Confirmação do pagamento libera o
                                            plano automaticamente (webhook ou aprovação imediata).
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Cartões salvos no Pagar.me
                                        </p>
                                        {!billingData.saved_cards?.length && (
                                            <p className="mt-2 text-xs text-zinc-500">
                                                Nenhum cartão cadastrado ainda. Cartões aparecem aqui após pagamentos com
                                                cartão pelo gateway (quando o cliente existir no Pagar.me).
                                            </p>
                                        )}
                                        {!!billingData.saved_cards?.length && (
                                            <ul className="mt-3 space-y-2">
                                                {billingData.saved_cards.map((c) => (
                                                    <li
                                                        key={c.id || c.last_four}
                                                        className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/80"
                                                    >
                                                        <span>
                                                            <span className="font-medium capitalize">{c.brand || "Cartão"}</span>
                                                            {c.last_four ? ` •••• ${c.last_four}` : ""}
                                                            {c.exp ? ` · validade ${c.exp}` : ""}
                                                        </span>
                                                        <span className="text-xs text-zinc-400">{c.status || "—"}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>

                                    {!!billingData.invoice_history?.length && (
                                        <div>
                                            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                                                Histórico de faturas
                                            </p>
                                            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                                                <table className="w-full text-left text-sm">
                                                    <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-800">
                                                        <tr>
                                                            <th className="px-3 py-2">Valor</th>
                                                            <th className="px-3 py-2">Status</th>
                                                            <th className="px-3 py-2">Vencimento</th>
                                                            <th className="px-3 py-2">Pago em</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {billingData.invoice_history.map((inv) => (
                                                            <tr
                                                                key={inv.id}
                                                                className="border-t border-zinc-100 dark:border-zinc-800"
                                                            >
                                                                <td className="px-3 py-2">
                                                                    {Number(inv.amount).toLocaleString("pt-BR", {
                                                                        style:    "currency",
                                                                        currency: "BRL",
                                                                    })}
                                                                </td>
                                                                <td className="px-3 py-2 capitalize">{inv.status}</td>
                                                                <td className="px-3 py-2 text-xs text-zinc-600">
                                                                    {new Date(inv.due_at).toLocaleDateString("pt-BR")}
                                                                </td>
                                                                <td className="px-3 py-2 text-xs text-zinc-600">
                                                                    {inv.paid_at
                                                                        ? new Date(inv.paid_at).toLocaleString("pt-BR", {
                                                                              dateStyle: "short",
                                                                              timeStyle: "short",
                                                                          })
                                                                        : "—"}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => {
                                        loadBilling().catch(() => {});
                                    }}
                                        className="text-xs font-semibold text-violet-600 hover:text-violet-700"
                                    >
                                        Atualizar dados
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* ── ABA: FORMAS DE PAGAMENTO (CLIENTE / PDV) ──────── */}
                    {activeTab === "formas_pagamento" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={CreditCard} title="Métodos de Pagamento" desc="Escolha quais formas de pagamento seu estabelecimento aceita" />

                            <div className="flex flex-col gap-3">
                                {ALL_PAYMENTS.map(({ key, label, desc }) => (
                                    <div
                                        key={key}
                                        className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
                                            enabledPayments[key]
                                                ? "border-violet-200 bg-violet-50 dark:border-violet-700/40 dark:bg-violet-900/10"
                                                : "border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                                                enabledPayments[key]
                                                    ? "bg-violet-100 dark:bg-violet-800/40"
                                                    : "bg-zinc-100 dark:bg-zinc-700"
                                            }`}>
                                                <Wallet className={`h-4 w-4 ${enabledPayments[key] ? "text-violet-600" : "text-zinc-400"}`} />
                                            </div>
                                            <div>
                                                <p className={`text-sm font-semibold ${enabledPayments[key] ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>{label}</p>
                                                <p className="text-xs text-zinc-400">{desc}</p>
                                            </div>
                                        </div>
                                        <Toggle
                                            checked={!!enabledPayments[key]}
                                            onChange={(v) => setEnabledPayments((prev) => ({ ...prev, [key]: v }))}
                                        />
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-700/40 dark:bg-blue-900/20">
                                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                                <p className="text-xs text-blue-700 dark:text-blue-400">
                                    Os métodos habilitados serão exibidos no chatbot como opções ao cliente e na criação manual de pedidos.
                                </p>
                            </div>

                            <SaveBar saving={saving} msg={msg} onSave={save} />
                        </div>
                    )}

                    {/* ── ABA: SEGURANÇA ────────────────────────────────── */}
                    {activeTab === "seguranca" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={Shield} title="Segurança da Conta" desc="Senha, e-mail e proteção da conta" />

                            {/* Info cards */}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="flex items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <Lock className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                                    <div>
                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Alterar Senha</p>
                                        <p className="mt-1 text-xs text-zinc-400">Para alterar sua senha, acesse a tela de Login e use a opção "Esqueci minha senha".</p>
                                        <a
                                            href="/login"
                                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700"
                                        >
                                            Ir para Login <span>→</span>
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <Mail className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                                    <div>
                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">E-mail Cadastrado</p>
                                        <p className="mt-1 text-xs text-zinc-500">{email || "Não informado"}</p>
                                        <p className="mt-1 text-xs text-zinc-400">Altere o e-mail na aba Geral e salve.</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <Phone className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
                                    <div>
                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">2FA — Autenticação em 2 fatores</p>
                                        <p className="mt-1 text-xs text-zinc-400">Adicione uma camada extra de proteção à sua conta.</p>
                                        <span className="mt-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-600">
                                            Em breve
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-700/40 dark:bg-amber-900/20">
                                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                    Nunca compartilhe sua chave de API do Agente de Impressão ou tokens de integração com terceiros.
                                    Gestão de equipe e perfis fica na aba Geral.
                                </p>
                            </div>
                        </div>
                    )}
                    </>
                    )}

                    {/* ── ABA: CHATBOT ───────────────────────────────────── */}
                    {activeTab === "chatbot" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle
                                icon={Bot}
                                title="Configurações do Chatbot"
                                desc="IA, confirmação de pedidos e mensagens ao cliente"
                            />

                            {!chatbotId && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-400">
                                    Nenhum chatbot encontrado para esta empresa. Crie um chatbot primeiro.
                                </div>
                            )}

                            <div className="space-y-5 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        Motor de IA
                                    </label>
                                    <select
                                        value={llmProvider}
                                        onChange={(e) => setLlmProvider(e.target.value === "openai" ? "openai" : "anthropic")}
                                        disabled={!chatbotId}
                                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                    >
                                        <option value="anthropic">
                                            Claude Haiku 4.5 (Anthropic) — recomendado
                                        </option>
                                        <option value="openai">GPT-5 mini (OpenAI) — custo menor</option>
                                    </select>
                                    <p className="text-[11px] text-zinc-400">
                                        Claude Haiku é o motor validado em produção. GPT-5 mini custa menos por
                                        pedido.
                                    </p>
                                </div>

                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Inteligência artificial (IA)
                                        </p>
                                        <p className="mt-0.5 text-xs text-zinc-400">
                                            Desligada = só Flow/catálogo (não consome crédito).
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={aiEnabled}
                                        disabled={!chatbotId}
                                        onClick={() => setAiEnabled((v) => !v)}
                                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                                            aiEnabled ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"
                                        }`}
                                    >
                                        <span
                                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                                                aiEnabled ? "translate-x-5" : "translate-x-0"
                                            }`}
                                        />
                                    </button>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        Modo da IA no WhatsApp
                                    </label>
                                    <select
                                        value={aiOrderMode}
                                        onChange={(e) =>
                                            setAiOrderMode(
                                                e.target.value === "info_only"
                                                    ? "info_only"
                                                    : "close_orders"
                                            )
                                        }
                                        disabled={!chatbotId || !aiEnabled}
                                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                    >
                                        <option value="close_orders">
                                            Fecha pedidos (padrão)
                                        </option>
                                        <option value="info_only">
                                            Só informações (pedido no cardápio web)
                                        </option>
                                    </select>
                                    <p className="text-[11px] text-zinc-400">
                                        Em “Só informações” a IA não fecha pedido pelo chat; o cliente
                                        usa o cardápio web, Flow ou atendente.
                                    </p>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                            Idle da sessão (minutos)
                                        </label>
                                        <input
                                            type="number"
                                            min={15}
                                            max={1440}
                                            value={sessionIdleMinutes}
                                            onChange={(e) => setSessionIdleMinutes(e.target.value)}
                                            disabled={!chatbotId}
                                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                        />
                                        <p className="text-[11px] text-zinc-400">
                                            Sem mensagem neste tempo, a conversa WhatsApp reinicia
                                            (padrão 120).
                                        </p>
                                    </div>
                                    {aiOrderMode === "info_only" ? (
                                        <>
                                            <div className="flex flex-col gap-1">
                                                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                                    Janela da cota IA (minutos)
                                                </label>
                                                <input
                                                    type="number"
                                                    min={5}
                                                    max={1440}
                                                    value={aiSessionWindowMinutes}
                                                    onChange={(e) =>
                                                        setAiSessionWindowMinutes(e.target.value)
                                                    }
                                                    disabled={!chatbotId || !aiEnabled}
                                                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                                />
                                                <p className="text-[11px] text-zinc-400">
                                                    Contador wall-clock da cota (padrão 60).
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-1 sm:col-span-2">
                                                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                                    Máx. mensagens IA por janela (0 = ilimitado)
                                                </label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={500}
                                                    value={aiMaxTurnsPerSession}
                                                    onChange={(e) =>
                                                        setAiMaxTurnsPerSession(e.target.value)
                                                    }
                                                    disabled={!chatbotId || !aiEnabled}
                                                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                                />
                                                <p className="text-[11px] text-zinc-400">
                                                    Ao estourar, a IA para e o bot oferece cardápio /
                                                    atendente / Flow (sem chamar Anthropic).
                                                </p>
                                            </div>
                                        </>
                                    ) : null}
                                </div>

                                {aiWallet ? (
                                    <AiCreditUsageMeter
                                        remainingTotalCents={aiWallet.remainingTotalCents}
                                        includedBudgetCents={aiWallet.includedBudgetCents}
                                        prepaidBalanceCents={aiWallet.prepaidBalanceCents}
                                    />
                                ) : null}
                            </div>

                            {/* Crédito IA: compra agora vs recarga automática (separados) */}
                            <div className="space-y-5 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                        Crédito de IA
                                    </p>
                                    <p className="mt-0.5 text-xs text-zinc-400">
                                        Duas formas distintas: comprar agora (PIX) ou deixar o cartão
                                        recarregar sozinho quando acabar.
                                    </p>
                                </div>

                                <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                                        1 · Comprar crédito agora
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-zinc-500">
                                        Gera um PIX. O crédito entra após o pagamento confirmar.
                                    </p>
                                    <div className="mt-3 grid grid-cols-3 gap-2">
                                        {([1000, 2000, 5000] as const).map((cents) => (
                                            <button
                                                key={`buy-${cents}`}
                                                type="button"
                                                disabled={aiPackLoading !== null || !aiWallet}
                                                onClick={async () => {
                                                    setAiPackLoading(cents);
                                                    setAiPackPix(null);
                                                    setAiPackCopied(false);
                                                    setBotMsg(null);
                                                    try {
                                                        const res = await fetch(
                                                            "/api/admin/ai-wallet/checkout",
                                                            {
                                                                method: "POST",
                                                                credentials: "include",
                                                                headers: {
                                                                    "Content-Type": "application/json",
                                                                },
                                                                body: JSON.stringify({
                                                                    packCents: cents,
                                                                }),
                                                            }
                                                        );
                                                        const json = await res.json().catch(() => ({}));
                                                        if (!res.ok) {
                                                            setBotMsg(
                                                                json?.error ??
                                                                    "Falha ao gerar PIX do crédito"
                                                            );
                                                            return;
                                                        }
                                                        const rawCode =
                                                            typeof json.pixQrCode === "string"
                                                                ? String(json.pixQrCode).trim()
                                                                : "";
                                                        // Só EMV BR Code (000201…) — rejeita PNG/binário
                                                        const code =
                                                            rawCode.startsWith("000201") &&
                                                            /br\.gov\.bcb\.pix/i.test(rawCode) &&
                                                            /^[\x20-\x7E]+$/.test(rawCode)
                                                                ? rawCode
                                                                : null;
                                                        const url =
                                                            typeof json.pixUrl === "string" &&
                                                            String(json.pixUrl).startsWith("http")
                                                                ? String(json.pixUrl)
                                                                : null;
                                                        if (!code && !url) {
                                                            setBotMsg(
                                                                "PIX criado, mas o Pagar.me não devolveu código/QR. Tente de novo."
                                                            );
                                                            return;
                                                        }
                                                        setAiPackPix({
                                                            code,
                                                            url,
                                                            amountBrl:
                                                                typeof json.amountBrl === "number"
                                                                    ? json.amountBrl
                                                                    : cents / 100,
                                                        });
                                                        setBotMsg(
                                                            "✓ PIX gerado — escaneie o QR ou copie o código"
                                                        );
                                                    } finally {
                                                        setAiPackLoading(null);
                                                    }
                                                }}
                                                className="flex flex-col items-center rounded-lg border border-violet-200 bg-white px-2 py-2.5 text-center hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:bg-zinc-900 dark:hover:bg-violet-950/40"
                                            >
                                                <span className="text-sm font-bold text-violet-700 dark:text-violet-300">
                                                    {aiPackLoading === cents
                                                        ? "…"
                                                        : `R$ ${cents / 100}`}
                                                </span>
                                                <span className="text-[10px] text-zinc-500">
                                                    pagar via PIX
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                    {aiPackPix ? (
                                        <div className="mt-4 space-y-3">
                                            {aiPackPix.amountBrl != null ? (
                                                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                                    Valor:{" "}
                                                    {aiPackPix.amountBrl.toLocaleString("pt-BR", {
                                                        style: "currency",
                                                        currency: "BRL",
                                                    })}
                                                </p>
                                            ) : null}
                                            <div className="flex flex-wrap items-start gap-3">
                                                {aiPackPix.url ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={aiPackPix.url}
                                                        alt="QR Code PIX"
                                                        className="h-40 w-40 rounded-xl border border-zinc-200 bg-white object-contain p-1 dark:border-zinc-700"
                                                    />
                                                ) : null}
                                                <div className="min-w-[200px] flex-1 space-y-2">
                                                    {aiPackPix.code ? (
                                                        <>
                                                            <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                                                                PIX copia e cola
                                                            </p>
                                                            <textarea
                                                                readOnly
                                                                rows={4}
                                                                value={aiPackPix.code}
                                                                onFocus={(e) => e.target.select()}
                                                                className="w-full rounded-lg border border-zinc-200 bg-white p-2 font-mono text-[10px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={async () => {
                                                                    try {
                                                                        await navigator.clipboard.writeText(
                                                                            aiPackPix.code!
                                                                        );
                                                                        setAiPackCopied(true);
                                                                        setTimeout(
                                                                            () => setAiPackCopied(false),
                                                                            2000
                                                                        );
                                                                    } catch {
                                                                        setBotMsg(
                                                                            "Não foi possível copiar. Selecione o código manualmente."
                                                                        );
                                                                    }
                                                                }}
                                                                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900"
                                                            >
                                                                {aiPackCopied
                                                                    ? "Copiado!"
                                                                    : "Copiar código PIX"}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <p className="text-[11px] text-zinc-500">
                                                                O banco devolveu só o QR (sem copia e cola).
                                                                Escaneie a imagem ou abra o link.
                                                            </p>
                                                            {aiPackPix.url ? (
                                                                <a
                                                                    href={aiPackPix.url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="inline-flex rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                                                                >
                                                                    Abrir página PIX
                                                                </a>
                                                            ) : null}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                                                2 · Recarga automática
                                            </p>
                                            <p className="mt-0.5 text-[11px] text-zinc-500">
                                                Não compra agora. Quando o crédito zerar, cobra no
                                                cartão salvo o valor escolhido abaixo.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={Boolean(aiWallet?.autoRechargeEnabled)}
                                            disabled={!aiWallet}
                                            onClick={async () => {
                                                if (!aiWallet) return;
                                                const next = !aiWallet.autoRechargeEnabled;
                                                const pack =
                                                    aiWallet.autoRechargePackCents ?? 2000;
                                                const res = await fetch("/api/admin/ai-wallet", {
                                                    method: "PATCH",
                                                    credentials: "include",
                                                    headers: {
                                                        "Content-Type": "application/json",
                                                    },
                                                    body: JSON.stringify({
                                                        autoRechargeEnabled: next,
                                                        autoRechargePackCents: next ? pack : null,
                                                    }),
                                                });
                                                const json = await res.json().catch(() => ({}));
                                                if (json?.wallet) setAiWallet(json.wallet);
                                            }}
                                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                                                aiWallet?.autoRechargeEnabled
                                                    ? "bg-violet-600"
                                                    : "bg-zinc-300 dark:bg-zinc-600"
                                            }`}
                                        >
                                            <span
                                                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                                                    aiWallet?.autoRechargeEnabled
                                                        ? "translate-x-5"
                                                        : "translate-x-0"
                                                }`}
                                            />
                                        </button>
                                    </div>
                                    {aiWallet?.autoRechargeEnabled ? (
                                        <label className="mt-3 block">
                                            <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                                                Valor da recarga quando acabar
                                            </span>
                                            <select
                                                value={String(
                                                    aiWallet.autoRechargePackCents ?? 2000
                                                )}
                                                onChange={async (e) => {
                                                    const cents = Number(e.target.value) as
                                                        | 1000
                                                        | 2000
                                                        | 5000;
                                                    const res = await fetch(
                                                        "/api/admin/ai-wallet",
                                                        {
                                                            method: "PATCH",
                                                            credentials: "include",
                                                            headers: {
                                                                "Content-Type": "application/json",
                                                            },
                                                            body: JSON.stringify({
                                                                autoRechargeEnabled: true,
                                                                autoRechargePackCents: cents,
                                                            }),
                                                        }
                                                    );
                                                    const json = await res.json().catch(() => ({}));
                                                    if (json?.wallet) setAiWallet(json.wallet);
                                                }}
                                                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                            >
                                                <option value="1000">R$ 10</option>
                                                <option value="2000">R$ 20 (recomendado)</option>
                                                <option value="5000">R$ 50</option>
                                            </select>
                                        </label>
                                    ) : (
                                        <p className="mt-2 text-[11px] text-zinc-400">
                                            Ligada = só define o valor futuro; não gera PIX.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Confirmação em pedidos de valor alto
                                        </p>
                                        <p className="mt-0.5 text-xs text-zinc-400">
                                            Pedidos acima do valor pedem confirmação reforçada no WhatsApp.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={highValueConfirmEnabled}
                                        disabled={!chatbotId}
                                        onClick={() => setHighValueConfirmEnabled((v) => !v)}
                                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                                            highValueConfirmEnabled
                                                ? "bg-violet-600"
                                                : "bg-zinc-300 dark:bg-zinc-600"
                                        }`}
                                    >
                                        <span
                                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                                                highValueConfirmEnabled ? "translate-x-5" : "translate-x-0"
                                            }`}
                                        />
                                    </button>
                                </div>
                                {highValueConfirmEnabled ? (
                                    <label className="block max-w-xs">
                                        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                                            Valor mínimo (R$)
                                        </span>
                                        <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={highValueConfirmAmount}
                                            onChange={(e) => setHighValueConfirmAmount(e.target.value)}
                                            disabled={!chatbotId}
                                            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                                        />
                                    </label>
                                ) : null}
                            </div>

                            <ChatbotMessageTemplatesPanel
                                welcomeReturning={msgWelcomeReturning}
                                welcomeFirst={msgWelcomeFirst}
                                outForDelivery={msgOutForDelivery}
                                thankYou={msgThankYou}
                                disabled={!chatbotId}
                                onChange={(patch) => {
                                    if (patch.welcomeReturning !== undefined) {
                                        setMsgWelcomeReturning(patch.welcomeReturning);
                                    }
                                    if (patch.welcomeFirst !== undefined) {
                                        setMsgWelcomeFirst(patch.welcomeFirst);
                                    }
                                    if (patch.outForDelivery !== undefined) {
                                        setMsgOutForDelivery(patch.outForDelivery);
                                    }
                                    if (patch.thankYou !== undefined) {
                                        setMsgThankYou(patch.thankYou);
                                    }
                                }}
                            />

                            {/* save bar */}
                            {botMsg && (
                                <div className={`rounded-lg px-3 py-2 text-sm font-medium ${
                                    botMsg.startsWith("✓")
                                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-400"
                                        : "border border-red-200 bg-red-50 text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-400"
                                }`}>
                                    {botMsg}
                                </div>
                            )}
                            <div className="flex justify-end">
                                <button
                                    onClick={saveChatbot}
                                    disabled={botSaving || !chatbotId}
                                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
                                >
                                    {botSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Salvar configurações
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── ABA: CARDÁPIO WEB ───────────────────────────────── */}
                    {activeTab === "cardapio" && (
                        <div className="flex flex-col gap-6">
                            <MenuCardapioSettings />
                            <MenuAnalyticsPanel />
                            <MarketPlanGate
                                featureKey="marketplace_ifood"
                                title="Integração iFood"
                                description="Sincronize catálogo e pedidos do iFood no Lysthub."
                            >
                                <MarketplaceIfoodSettings />
                            </MarketPlanGate>
                            <MarketPlanGate
                                featureKey="marketplace_aiqfome"
                                title="Integração Aiqfome"
                                description="Sincronize catálogo e pedidos do Aiqfome no Lysthub."
                            >
                                <MarketplaceAiqfomeSettings />
                            </MarketPlanGate>
                            <MarketPlanGate
                                featureKey="omnichannel_ig_messenger"
                                title="Instagram e Messenger"
                                description="Atendimento do chatbot também nas redes Meta."
                            >
                                <MetaMessagingSettings />
                            </MarketPlanGate>
                            <MarketPlanGate
                                featureKey="table_service"
                                title="Atendimento de mesa"
                                description="Comandas e salão no mesmo sistema do delivery."
                            >
                                <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                                    <p className="text-zinc-700 dark:text-zinc-200">
                                        Gerencie mesas, comandas e fechamento no módulo{" "}
                                        <a
                                            href="/mesa"
                                            className="font-semibold text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
                                        >
                                            Mesas
                                        </a>
                                        .
                                    </p>
                                    <p className="mt-2 text-xs text-zinc-500">
                                        Cadastre mesas na própria tela e feche a conta com o caixa
                                        aberto (mesmo fluxo do PDV).
                                    </p>
                                </div>
                            </MarketPlanGate>
                        </div>
                    )}

                    {/* ── ABA: PEDIDOS ────────────────────────────────────── */}
                    {activeTab === "pedidos" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={Package} title="Configurações de Pedidos" desc="Controle de aprovação, impressão automática e fluxo de confirmação" />

                            {/* Aprovação de pedidos */}
                            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-5 space-y-4">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Exigir aprovação manual
                                        </p>
                                        <p className="text-xs text-zinc-400 mt-0.5">
                                            Pedidos do catálogo ficam em fila até serem confirmados por um operador.
                                            Se desligado, pedidos são confirmados automaticamente ao serem recebidos.
                                        </p>
                                    </div>
                                    <Toggle checked={requireApproval} onChange={setRequireApproval} />
                                </div>

                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Impressão automática
                                        </p>
                                        <p className="text-xs text-zinc-400 mt-0.5">
                                            Imprime automaticamente quando um pedido é confirmado (requer Agente de Impressão instalado).
                                            Se &quot;Aprovação manual&quot; estiver ligada, imprime após a confirmação do operador.
                                        </p>
                                    </div>
                                    <Toggle checked={autoPrint} onChange={setAutoPrint} />
                                </div>
                            </div>

                            {/* Resumo do fluxo */}
                            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50 space-y-2">
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Fluxo de pedido (catálogo WhatsApp)</p>
                                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                                    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                                        Flow Catálogo
                                    </span>
                                    <span>→</span>
                                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                                        Flow Checkout
                                    </span>
                                    <span>→</span>
                                    <span className={`rounded-full px-2.5 py-0.5 font-semibold ${
                                        requireApproval
                                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300"
                                            : "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
                                    }`}>
                                        {requireApproval ? "Fila de aprovação" : "Confirmado automaticamente"}
                                    </span>
                                    {autoPrint && (
                                        <>
                                            <span>→</span>
                                            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 font-semibold text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
                                                Impressão automática
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Save feedback */}
                            {settingsMsg && (
                                <div className={`rounded-lg px-3 py-2 text-sm font-medium ${
                                    settingsMsg.startsWith("✓")
                                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-400"
                                        : "border border-red-200 bg-red-50 text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-400"
                                }`}>
                                    {settingsMsg}
                                </div>
                            )}
                            <div className="flex justify-end">
                                <button
                                    onClick={saveOrderSettings}
                                    disabled={settingsSaving}
                                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
                                >
                                    {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Salvar configurações
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <ConfirmDialog
                    open={confirmDeleteOpen}
                    title="Excluir bairro da regra?"
                    description={pendingDeleteNeighborhood ? `O bairro "${pendingDeleteNeighborhood}" será removido das regras de atendimento.` : ""}
                    confirmLabel="Excluir bairro"
                    onCancel={() => {
                        setConfirmDeleteOpen(false);
                        setPendingDeleteNeighborhood(null);
                    }}
                    onConfirm={confirmDeleteNeighborhood}
                />
            </div>
        </div>
    );
}

export default function ConfiguracoesPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                    <p className="text-sm text-zinc-500">Carregando configurações…</p>
                </div>
            }
        >
            <ConfiguracoesPageContent />
        </Suspense>
    );
}
