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
    Save,
    Shield,
    ShieldAlert,
    Store,
    Truck,
    Users,
    Wallet,
    CircleDollarSign,
    CalendarClock,
} from "lucide-react";

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

type Tab = "geral" | "delivery" | "plano" | "formas_pagamento" | "seguranca" | "chatbot" | "pedidos";

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
    monthly_prices_brl?: { bot: number; complete: number };
    setup_prices_brl?:   { bot: number; complete: number };
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
    const [chatbotModel,    setChatbotModel]     = useState("claude-haiku-4-5-20251001");
    const [chatbotThreshold,setChatbotThreshold] = useState("0.75");
    const [chatbotRetries,  setChatbotRetries]   = useState("2");
    const [chatbotTimeout,  setChatbotTimeout]   = useState("8000");
    const [botSaving,       setBotSaving]        = useState(false);
    const [botMsg,          setBotMsg]           = useState<string | null>(null);
    const botMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // company_settings (pedidos)
    const [requireApproval, setRequireApproval] = useState(false);
    const [autoPrint,       setAutoPrint]       = useState(false);
    const [settingsSaving,  setSettingsSaving]  = useState(false);
    const [settingsMsg,     setSettingsMsg]     = useState<string | null>(null);
    const settingsMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            }),
        });
        const json = await res.json().catch(() => ({}));
        setSaving(false);
        if (!res.ok) {
            setDeliveryPolicyMsg(json?.error ?? "Erro ao salvar política de entrega.");
            return;
        }
        setDeliveryPolicyMsg("✓ Política de entrega salva.");
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

    async function changeRenthusPlan(plan: "bot" | "complete") {
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
                setChatbotModel(cfg.model     ?? "claude-haiku-4-5-20251001");
                setChatbotThreshold(String(cfg.threshold  ?? "0.75"));
                setChatbotRetries(String(cfg.max_retries ?? "2"));
                setChatbotTimeout(String(cfg.timeout_ms  ?? "8000"));
            })
            .catch(() => {});
    }, []);

    // ── load / save company_settings ──────────────────────────────────────────
    useEffect(() => {
        if (!companyId) return;
        supabase
            .from("company_settings")
            .select("require_order_approval, auto_print_orders")
            .eq("company_id", companyId)
            .maybeSingle()
            .then(({ data }) => {
                if (!data) return;
                setRequireApproval(!!data.require_order_approval);
                setAutoPrint(!!data.auto_print_orders);
            });
    }, [companyId, supabase]);

    async function saveOrderSettings() {
        if (!companyId) return;
        setSettingsSaving(true); setSettingsMsg(null);

        const { error } = await supabase
            .from("company_settings")
            .update({ require_order_approval: requireApproval, auto_print_orders: autoPrint })
            .eq("company_id", companyId);

        setSettingsMsg(error ? (error.message ?? "Erro ao salvar") : "✓ Configurações de pedidos salvas");
        setSettingsSaving(false);
        if (settingsMsgTimer.current) clearTimeout(settingsMsgTimer.current);
        settingsMsgTimer.current = setTimeout(() => setSettingsMsg(null), 4000);
    }

    async function saveChatbot() {
        if (!chatbotId) { setBotMsg("Nenhum chatbot encontrado para esta empresa."); return; }
        setBotSaving(true); setBotMsg(null);
        const res = await fetch("/api/chatbot/config", {
            method:  "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: chatbotId,
                config: {
                    provider:             "anthropic",
                    model:                chatbotModel,
                    threshold:            Number(chatbotThreshold) || 0.75,
                    max_retries:          Number(chatbotRetries)   || 2,
                    timeout_ms:           Number(chatbotTimeout)   || 8000,
                    fallback_chain:       ["claude", "regex", "assisted"],
                    catalog_cache_ttl_min: 15,
                },
            }),
        });
        const json = await res.json().catch(() => ({}));
        setBotMsg(res.ok ? "✓ Configurações do chatbot salvas" : (json?.error ?? "Erro ao salvar"));
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
                        </div>
                    )}

                    {/* ── ABA: DELIVERY ─────────────────────────────────── */}
                    {activeTab === "delivery" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={Bike} title="Configurações de Delivery" desc="Cidade atendida, bairros, taxas e estimativa de entrega" />

                            <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cobrar taxa de entrega</p>
                                    <p className="text-xs text-zinc-400">Habilita o campo de taxa de entrega nos pedidos</p>
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

                    {/* ── ABA: PLANO E PAGAMENTOS (RENTHUS) ─────────────── */}
                    {activeTab === "plano" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle
                                icon={CircleDollarSign}
                                title="Plano e pagamentos Renthus"
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
                                                            {plan === "complete" ? "Completo" : plan === "bot" ? "Bot" : plan || "—"}
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
                                        const pk   = sub?.plan === "complete" ? ("complete" as const) : ("bot" as const);

                                        const isFirstPayment = st === "trial" || st === "pending_setup";
                                        const sp   = billingData.setup_prices_brl   ?? { bot: 497, complete: 997 };
                                        const mp   = billingData.monthly_prices_brl ?? { bot: 297, complete: 397 };

                                        // Pending record: setup_payment para primeiro pagamento, invoice para os demais
                                        const pendSetup   = billingData.pending_setup_payment;
                                        const pendInv     = billingData.pending_invoice;
                                        const pendRecord  = isFirstPayment ? pendSetup : pendInv;

                                        let refAmount: number;
                                        if (pendRecord) {
                                            refAmount = Number(pendRecord.amount);
                                        } else if (isFirstPayment) {
                                            refAmount = sp[pk];
                                        } else {
                                            refAmount = mp[pk];
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
                                                    {isFirstPayment ? "Ativar plano Renthus" : "Pagar mensalidade Renthus"}
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
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {(["bot", "complete"] as const).map((p) => {
                                                    const active =
                                                        billingData.pagarme_subscription?.plan === p;
                                                    const mp = billingData.monthly_prices_brl ?? {
                                                        bot:      297,
                                                        complete: 397,
                                                    };
                                                    const price = p === "bot" ? mp.bot : mp.complete;
                                                    return (
                                                        <div
                                                            key={p}
                                                            className={`rounded-xl border-2 p-4 ${
                                                                active
                                                                    ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
                                                                    : "border-zinc-200 dark:border-zinc-700"
                                                            }`}
                                                        >
                                                            <p className="font-bold text-zinc-900 dark:text-zinc-100">
                                                                {p === "bot" ? "Bot" : "Completo"}
                                                            </p>
                                                            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                                                                {price.toLocaleString("pt-BR", {
                                                                    style:    "currency",
                                                                    currency: "BRL",
                                                                })}
                                                                /mês após o teste
                                                            </p>
                                                            <button
                                                                type="button"
                                                                disabled={planSaving || active}
                                                                onClick={() => {
                                                                changeRenthusPlan(p).catch(() => {});
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

                                    {billingData.pagarme_subscription?.plan === "bot" &&
                                        (billingData.pagarme_subscription?.status === "active" ||
                                            billingData.pagarme_subscription?.status === "overdue") && (
                                            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                                                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                                    Upgrade para o plano Completo
                                                </p>
                                                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                                    Mais recursos de ERP e gestão. A próxima cobrança seguirá o valor do
                                                    plano Completo (
                                                    {(billingData.monthly_prices_brl?.complete ?? 397).toLocaleString("pt-BR", {
                                                        style:    "currency",
                                                        currency: "BRL",
                                                    })}
                                                    /mês).
                                                </p>
                                                <button
                                                    type="button"
                                                    disabled={planSaving}
                                                    onClick={() => {
                                                    changeRenthusPlan("complete").catch(() => {});
                                                }}
                                                    className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                                                >
                                                    {planSaving ? "Salvando…" : "Fazer upgrade"}
                                                </button>
                                            </div>
                                        )}

                                    {billingData.pagarme_subscription?.plan === "complete" &&
                                        billingData.pagarme_subscription?.status !== "trial" && (
                                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                                Você já está no plano Completo.
                                            </p>
                                        )}

                                    <SectionTitle
                                        icon={CreditCard}
                                        title="Formas de pagamento (cobrança Renthus)"
                                        desc="Como você paga a mensalidade da plataforma — não confunde com formas aceitas no delivery"
                                    />
                                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            PIX e cartão
                                        </p>
                                        <p className="mt-1 text-xs text-zinc-500">
                                            Use o bloco &quot;Pagar mensalidade Renthus&quot; acima: PIX (QR e copia e
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
                            <SectionTitle icon={Shield} title="Segurança da Conta" desc="Gerenciamento de acesso e equipe" />

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
                                    <Users className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
                                    <div>
                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Gestão de Equipe</p>
                                        <p className="mt-1 text-xs text-zinc-400">Adicione colaboradores, defina funções e permissões de acesso ao sistema.</p>
                                        <span className="mt-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-600">
                                            Em breve
                                        </span>
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
                                </p>
                            </div>
                        </div>
                    )}
                    </>
                    )}

                    {/* ── ABA: CHATBOT ───────────────────────────────────── */}
                    {activeTab === "chatbot" && (
                        <div className="flex flex-col gap-6">
                            <SectionTitle icon={Bot} title="Configurações do Chatbot" desc="Ajuste o modelo de IA e os parâmetros de resposta" />

                            {!chatbotId && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-400">
                                    Nenhum chatbot encontrado para esta empresa. Crie um chatbot primeiro.
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                {/* Modelo */}
                                <div className="flex flex-col gap-1 sm:col-span-2">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Modelo de IA</label>
                                    <select
                                        value={chatbotModel}
                                        onChange={(e) => setChatbotModel(e.target.value)}
                                        disabled={!chatbotId}
                                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                    >
                                        <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — rápido e econômico (recomendado)</option>
                                        <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — mais inteligente, maior custo</option>
                                    </select>
                                    <p className="text-[11px] text-zinc-400">O modelo é usado para interpretar pedidos em linguagem natural.</p>
                                </div>

                                {/* Threshold */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        Confiança mínima ({chatbotThreshold})
                                    </label>
                                    <input
                                        type="range"
                                        min="0.5" max="1" step="0.05"
                                        value={chatbotThreshold}
                                        onChange={(e) => setChatbotThreshold(e.target.value)}
                                        disabled={!chatbotId}
                                        className="w-full accent-violet-600 disabled:opacity-50"
                                    />
                                    <div className="flex justify-between text-[10px] text-zinc-400">
                                        <span>0.5 — permissivo</span>
                                        <span>1.0 — rígido</span>
                                    </div>
                                    <p className="text-[11px] text-zinc-400">Abaixo desse valor o bot cai para o modo Regex / Assistido.</p>
                                </div>

                                {/* Max retries */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Tentativas máximas da IA</label>
                                    <select
                                        value={chatbotRetries}
                                        onChange={(e) => setChatbotRetries(e.target.value)}
                                        disabled={!chatbotId}
                                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                    >
                                        <option value="1">1 tentativa</option>
                                        <option value="2">2 tentativas (padrão)</option>
                                        <option value="3">3 tentativas</option>
                                    </select>
                                    <p className="text-[11px] text-zinc-400">Número de re-tentativas quando a IA falha ou excede o timeout.</p>
                                </div>

                                {/* Timeout */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Timeout da IA (ms)</label>
                                    <select
                                        value={chatbotTimeout}
                                        onChange={(e) => setChatbotTimeout(e.target.value)}
                                        disabled={!chatbotId}
                                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                                    >
                                        <option value="5000">5 segundos</option>
                                        <option value="8000">8 segundos (padrão)</option>
                                        <option value="12000">12 segundos</option>
                                        <option value="15000">15 segundos</option>
                                    </select>
                                    <p className="text-[11px] text-zinc-400">Se a IA demorar mais que isso, cai para o Regex.</p>
                                </div>
                            </div>

                            {/* info fallback chain */}
                            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-2">Cadeia de fallback (automática)</p>
                                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                                    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">1 · Claude IA</span>
                                    <span>→</span>
                                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">2 · Regex / Fuse.js</span>
                                    <span>→</span>
                                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">3 · Modo Assistido</span>
                                </div>
                            </div>

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
