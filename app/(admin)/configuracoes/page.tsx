// app/(admin)/configuracoes/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    BadgeCheck,
    Bike,
    Building2,
    CreditCard,
    Loader2,
    Lock,
    Mail,
    MapPin,
    Phone,
    Save,
    Shield,
    ShieldAlert,
    Store,
    Truck,
    Users,
    Wallet,
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

type Tab = "geral" | "delivery" | "pagamentos" | "seguranca";

// ─── helpers ──────────────────────────────────────────────────────────────────

function Field({
    label, value, onChange, placeholder = "", type = "text", hint,
}: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string; hint?: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</label>
            <input
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
            {msg
                ? <p className={`text-xs font-medium ${msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>{msg}</p>
                : <span />
            }
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

const ALL_PAYMENTS = [
    { key: "pix",          label: "Pix",          desc: "Transferência instantânea" },
    { key: "credit_card",  label: "Cartão de Crédito", desc: "Visa, Master, Elo, etc." },
    { key: "debit_card",   label: "Cartão de Débito",  desc: "Débito na maquininha" },
    { key: "cash",         label: "Dinheiro",     desc: "Pagamento em espécie" },
    { key: "voucher",      label: "Vale Refeição", desc: "Ticket, Sodexo, Alelo" },
];

// ─── main component ───────────────────────────────────────────────────────────

export default function ConfiguracoesPage() {
    const supabase = useMemo(() => createClient(), []);
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

    // pagamentos
    const [enabledPayments,  setEnabledPayments]  = useState<Record<string, boolean>>({
        pix: true, credit_card: true, debit_card: true, cash: true, voucher: false,
    });

    // segurança (informativo — não salva senha aqui)
    const [saving, setSaving]       = useState(false);
    const [msg,    setMsg]          = useState<string | null>(null);
    const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        { id: "geral",      label: "Geral",      icon: Store },
        { id: "delivery",   label: "Delivery",   icon: Truck },
        { id: "pagamentos", label: "Pagamentos",  icon: Wallet },
        { id: "seguranca",  label: "Segurança",   icon: Shield },
    ];

    // ── render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Configurações</h1>
                <p className="mt-0.5 text-xs text-zinc-400">Gerencie os dados e preferências da sua empresa</p>
            </div>

            <div className="flex gap-6">
                {/* ── TAB SIDEBAR ───────────────────────────────────────────── */}
                <nav className="flex w-48 shrink-0 flex-col gap-1">
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
                            <SectionTitle icon={Bike} title="Configurações de Delivery" desc="Taxas, raio e estimativa de entrega" />

                            <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cobrar taxa de entrega</p>
                                    <p className="text-xs text-zinc-400">Habilita o campo de taxa de entrega nos pedidos</p>
                                </div>
                                <Toggle checked={deliveryEnabled} onChange={setDeliveryEnabled} />
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                            <SaveBar saving={saving} msg={msg} onSave={save} />
                        </div>
                    )}

                    {/* ── ABA: PAGAMENTOS ───────────────────────────────── */}
                    {activeTab === "pagamentos" && (
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
                </div>
            </div>
        </div>
    );
}
