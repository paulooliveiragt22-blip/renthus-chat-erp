"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, Edit2,
  Home, Mail, MapPin, Phone, Plus, Search, Trash2, User, Users, X,
  CreditCard, Clock, TrendingDown, FileText,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

// ─── helpers ─────────────────────────────────────────────────────────────────
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (s: string) => new Date(s).toLocaleDateString("pt-BR");

function digitsOnly(s: string) {
  return s.replaceAll(/\D/g, "");
}

// ─── types ───────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  company_id: string;
  name: string | null;
  phone: string | null;
  phone_e164: string | null;
  address: string | null;
  neighborhood: string | null;
  cpf_cnpj: string | null;
  tipo_pessoa: "PF" | "PJ" | null;
  limite_credito: number;
  saldo_devedor: number;
  origem: string | null;
  email: string | null;
  notes: string | null;
  is_adult: boolean;
  created_at: string;
}

interface Endereco {
  id: string;
  apelido: string;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  is_principal: boolean;
}

interface VendaPrazo {
  id: string;
  original_amount: number;
  saldo_devedor: number;
  due_date: string;
  status: "open" | "partial" | "paid" | "overdue" | "canceled";
  description: string | null;
  paid_at: string | null;
  order_id: string | null;
}

const EMPTY_FORM = {
  name: "", phone: "", email: "", cpf_cnpj: "", tipo_pessoa: "PF" as "PF"|"PJ",
  limite_credito: "0", notes: "",
};

const EMPTY_ADDR = {
  apelido: "Casa", logradouro: "", numero: "", complemento: "",
  bairro: "", cidade: "", estado: "", cep: "",
};

// ─── CEP lookup ───────────────────────────────────────────────────────────────
async function fetchCep(cep: string) {
  const clean = digitsOnly(cep);
  if (clean.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    const d = await r.json();
    if (d.erro) return null;
    return { logradouro: d.logradouro, bairro: d.bairro, cidade: d.localidade, estado: d.uf };
  } catch { return null; }
}

function detailTabLabel(
  tab: "info" | "enderecos" | "dividas",
  enderecoCount: number,
  dividasOpen: number
): string {
  if (tab === "info") return "Dados";
  if (tab === "enderecos") return `Endereços (${enderecoCount})`;
  return `Fiado (${dividasOpen})`;
}

type DebtListItemProps = Readonly<{
  d: VendaPrazo;
  onMarkPaid: (id: string) => void;
}>;

function DebtListItem({ d, onMarkPaid }: DebtListItemProps) {
  const isPaid = d.status === "paid";
  const overdue = d.status === "overdue" || (!isPaid && new Date(d.due_date) < new Date());
  const isParcial = d.status === "partial";

  let rowClass =
    "flex items-center gap-3 rounded-xl border p-4 border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50";
  if (isPaid) {
    rowClass =
      "flex items-center gap-3 rounded-xl border p-4 border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10";
  } else if (overdue) {
    rowClass =
      "flex items-center gap-3 rounded-xl border p-4 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10";
  } else if (isParcial) {
    rowClass =
      "flex items-center gap-3 rounded-xl border p-4 border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/10";
  }

  let iconWrapClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-500";
  if (isPaid) {
    iconWrapClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600";
  } else if (overdue) {
    iconWrapClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-500";
  }

  let badgeClass =
    "rounded-full px-2 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  if (isPaid) {
    badgeClass =
      "rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  } else if (overdue) {
    badgeClass =
      "rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  } else if (isParcial) {
    badgeClass =
      "rounded-full px-2 py-0.5 text-[10px] font-bold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  }

  let statusLabel = "Pendente";
  if (isPaid) statusLabel = "Pago";
  else if (overdue) statusLabel = "Atrasado";
  else if (isParcial) statusLabel = "Parcial";

  return (
    <div className={rowClass}>
      <div className={iconWrapClass}>
        {isPaid && <CheckCircle2 className="h-4 w-4" />}
        {!isPaid && overdue && <AlertCircle className="h-4 w-4" />}
        {!isPaid && !overdue && <Clock className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
          {brl(d.saldo_devedor)}
          {isParcial && (
            <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
              de {brl(d.original_amount)}
            </span>
          )}
        </p>
        <p className="text-[11px] text-zinc-500">
          Venc. {fmtDate(d.due_date)}
          {d.description && ` · ${d.description}`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={badgeClass}>{statusLabel}</span>
        {!isPaid && (
          <button
            type="button"
            onClick={() => onMarkPaid(d.id)}
            className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-600 transition-colors"
          >
            <CheckCircle2 className="h-3 w-3" /> Receber
          </button>
        )}
      </div>
    </div>
  );
}

function CustomerListSkeleton() {
  const rowKeys = ["sk-0", "sk-1", "sk-2", "sk-3", "sk-4", "sk-5"];
  return (
    <div className="flex flex-col gap-3 p-4">
      {rowKeys.map((key) => (
        <div key={key} className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      ))}
    </div>
  );
}

type FormState = typeof EMPTY_FORM;

type CustomerFormModalProps = Readonly<{
  open: boolean;
  editingId: string | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}>;

function CustomerFormModal({
  open,
  editingId,
  form,
  setForm,
  saving,
  onClose,
  onSave,
}: CustomerFormModalProps) {
  const uid = useId();
  const idName = `${uid}-name`;
  const idPhone = `${uid}-phone`;
  const idEmail = `${uid}-email`;
  const idDoc = `${uid}-doc`;
  const idTipo = `${uid}-tipo`;
  const idLimite = `${uid}-limite`;
  const idNotes = `${uid}-notes`;

  let submitLabel = "Cadastrar";
  if (saving) submitLabel = "Salvando…";
  else if (editingId) submitLabel = "Salvar";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/20 text-violet-400">
            <User className="h-4 w-4" />
          </div>
          <p className="font-bold text-zinc-100">{editingId ? "Editar Cliente" : "Novo Cliente"}</p>
          <button type="button" onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto max-h-[70vh] p-6 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="col-span-2">
              <label htmlFor={idName} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Nome *
              </label>
              <input
                id={idName}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                placeholder="Nome completo"
              />
            </div>
            <div>
              <label htmlFor={idPhone} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                WhatsApp *
              </label>
              <input
                id={idPhone}
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                placeholder="+55 66 9…"
              />
            </div>
            <div>
              <label htmlFor={idEmail} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                E-mail
              </label>
              <input
                id={idEmail}
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                placeholder="email@exemplo.com"
              />
            </div>
            <div>
              <label htmlFor={idDoc} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                CPF / CNPJ
              </label>
              <input
                id={idDoc}
                value={form.cpf_cnpj}
                onChange={(e) => setForm((p) => ({ ...p, cpf_cnpj: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                placeholder="000.000.000-00"
              />
            </div>
            <div>
              <label htmlFor={idTipo} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Tipo
              </label>
              <select
                id={idTipo}
                value={form.tipo_pessoa}
                onChange={(e) => setForm((p) => ({ ...p, tipo_pessoa: e.target.value as "PF"|"PJ" }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
              >
                <option value="PF">Pessoa Física</option>
                <option value="PJ">Pessoa Jurídica</option>
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor={idLimite} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Limite de Crédito (Fiado)
              </label>
              <div className="flex items-center overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800">
                <span className="px-3 text-xs text-zinc-500">R$</span>
                <input
                  id={idLimite}
                  type="number"
                  min={0}
                  value={form.limite_credito}
                  onChange={(e) => setForm((p) => ({ ...p, limite_credito: e.target.value }))}
                  className="flex-1 bg-transparent py-2 pr-3 text-sm text-zinc-100 focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[10px] text-zinc-500">Deixe 0 para desabilitar pagamento A Prazo para este cliente.</p>
            </div>
            <div className="col-span-2">
              <label htmlFor={idNotes} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Observações
              </label>
              <textarea
                id={idNotes}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none resize-none"
                placeholder="Preferências, restrições…"
              />
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 px-6 py-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !form.name.trim() || !form.phone.trim()}
            className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40 transition-all"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type AddrFormState = typeof EMPTY_ADDR;

type AddressFormModalProps = Readonly<{
  open: boolean;
  addrForm: AddrFormState;
  setAddrForm: React.Dispatch<React.SetStateAction<AddrFormState>>;
  cepLoading: boolean;
  onCepChange: (val: string) => void;
  onClose: () => void;
  onSave: () => void;
}>;

function AddressFormModal({
  open,
  addrForm,
  setAddrForm,
  cepLoading,
  onCepChange,
  onClose,
  onSave,
}: AddressFormModalProps) {
  const uid = useId();
  const idApelido = `${uid}-apelido`;
  const idCep = `${uid}-cep`;
  const idNum = `${uid}-num`;
  const idLog = `${uid}-log`;
  const idBairro = `${uid}-bairro`;
  const idCidade = `${uid}-cidade`;
  const idUf = `${uid}-uf`;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
          <Home className="h-5 w-5 text-violet-400" />
          <p className="font-bold text-zinc-100">Novo Endereço</p>
          <button type="button" onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="col-span-2">
              <label htmlFor={idApelido} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Apelido
              </label>
              <input
                id={idApelido}
                value={addrForm.apelido}
                onChange={(e) => setAddrForm((p) => ({ ...p, apelido: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
                placeholder="Casa, Trabalho…"
              />
            </div>
            <div>
              <label htmlFor={idCep} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                CEP {cepLoading && <span className="text-orange-400">(buscando…)</span>}
              </label>
              <input
                id={idCep}
                value={addrForm.cep}
                onChange={(e) => onCepChange(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
                placeholder="00000-000"
                maxLength={9}
              />
            </div>
            <div>
              <label htmlFor={idNum} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Número
              </label>
              <input
                id={idNum}
                value={addrForm.numero}
                onChange={(e) => setAddrForm((p) => ({ ...p, numero: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
                placeholder="123"
              />
            </div>
            <div className="col-span-2">
              <label htmlFor={idLog} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Logradouro
              </label>
              <input
                id={idLog}
                value={addrForm.logradouro}
                onChange={(e) => setAddrForm((p) => ({ ...p, logradouro: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
                placeholder="Rua, Avenida…"
              />
            </div>
            <div>
              <label htmlFor={idBairro} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Bairro
              </label>
              <input
                id={idBairro}
                value={addrForm.bairro}
                onChange={(e) => setAddrForm((p) => ({ ...p, bairro: e.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-3 sm:flex-row sm:gap-2">
              <div className="flex-1">
                <label htmlFor={idCidade} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  Cidade
                </label>
                <input
                  id={idCidade}
                  value={addrForm.cidade}
                  onChange={(e) => setAddrForm((p) => ({ ...p, cidade: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
                  placeholder="Cidade"
                />
              </div>
              <div className="sm:w-24">
                <label htmlFor={idUf} className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  UF
                </label>
                <input
                  id={idUf}
                  value={addrForm.estado}
                  onChange={(e) => setAddrForm((p) => ({ ...p, estado: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none uppercase"
                  placeholder="UF"
                  maxLength={2}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 px-6 py-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 transition-all"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────
export default function ClientesPage() {
  const { currentCompanyId: companyId } = useWorkspace();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");

  const [selected, setSelected]     = useState<Customer | null>(null);
  const [enderecos, setEnderecos]   = useState<Endereco[]>([]);
  const [dividas,   setDividas]     = useState<VendaPrazo[]>([]);
  const [detailTab, setDetailTab]   = useState<"info"|"enderecos"|"dividas">("info");

  const [showForm,     setShowForm]    = useState(false);
  const [editingId,    setEditingId]   = useState<string|null>(null);
  const [form,         setForm]        = useState(EMPTY_FORM);
  const [saving,       setSaving]      = useState(false);

  const [showAddrForm, setShowAddrForm] = useState(false);
  const [addrForm,     setAddrForm]    = useState(EMPTY_ADDR);
  const [cepLoading,   setCepLoading]  = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const res = await fetch("/api/admin/customers", { credentials: "include", cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setCustomers((json.customers as Customer[]) ?? []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (c: Customer) => {
    setSelected(c);
    setDetailTab("info");
    const res = await fetch(`/api/admin/customers/${encodeURIComponent(c.id)}`, {
      credentials: "include",
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    setEnderecos((json.addresses as Endereco[]) ?? []);
    setDividas((json.bills as VendaPrazo[]) ?? []);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return customers;
    return customers.filter(c =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q) ||
      (c.cpf_cnpj ?? "").includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  const summary = useMemo(() => ({
    total:      customers.length,
    comCredito: customers.filter(c => c.limite_credito > 0).length,
    totalDivida: customers.reduce((s, c) => s + (c.saldo_devedor ?? 0), 0),
    inadimplente: customers.filter(c => c.saldo_devedor > 0).length,
  }), [customers]);

  const dividasOpenCount = useMemo(
    () => dividas.filter((d) => d.status !== "paid").length,
    [dividas]
  );

  const openNew = () => {
    setEditingId(null); setForm(EMPTY_FORM); setShowForm(true);
  };
  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({
      name:           c.name ?? "",
      phone:          c.phone ?? "",
      email:          c.email ?? "",
      cpf_cnpj:       c.cpf_cnpj ?? "",
      tipo_pessoa:    c.tipo_pessoa ?? "PF",
      limite_credito: String(c.limite_credito ?? 0),
      notes:          c.notes ?? "",
    });
    setShowForm(true);
  };

  const saveCustomer = async () => {
    if (!companyId || !form.name.trim() || !form.phone.trim()) return;
    setSaving(true);
    const payload = {
      name:           form.name.trim(),
      phone:          form.phone.trim(),
      email:          form.email.trim() || null,
      cpf_cnpj:       form.cpf_cnpj.trim() || null,
      tipo_pessoa:    form.tipo_pessoa,
      limite_credito: Number.parseFloat(form.limite_credito) || 0,
      notes:          form.notes.trim() || null,
    };
    if (editingId) {
      const res = await fetch("/api/admin/customers", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert("Erro: " + (json?.error ?? "falha")); setSaving(false); return; }
      setCustomers(p => p.map(c => c.id === editingId ? { ...c, ...payload } : c));
      if (selected?.id === editingId) setSelected(prev => prev ? { ...prev, ...payload } : prev);
    } else {
      const res = await fetch("/api/admin/customers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert("Erro: " + (json?.error ?? "falha")); setSaving(false); return; }
      setCustomers(p => [json.customer as Customer, ...p]);
    }
    setSaving(false);
    setShowForm(false);
  };

  const deleteCustomer = async (id: string) => {
    if (!confirm("Excluir este cliente? Pedidos existentes não serão afetados.")) return;
    await fetch(`/api/admin/customers?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
    setCustomers(p => p.filter(c => c.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleCepChange = async (val: string) => {
    setAddrForm(p => ({ ...p, cep: val }));
    if (digitsOnly(val).length === 8) {
      setCepLoading(true);
      const d = await fetchCep(val);
      if (d) setAddrForm(p => ({ ...p, logradouro: d.logradouro, bairro: d.bairro, cidade: d.cidade, estado: d.estado }));
      setCepLoading(false);
    }
  };

  const saveAddress = async () => {
    if (!selected || !companyId) return;
    const res = await fetch(`/api/admin/customers/${encodeURIComponent(selected.id)}/addresses`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apelido: addrForm.apelido || "Endereço",
        logradouro: addrForm.logradouro || null,
        numero: addrForm.numero || null,
        complemento: addrForm.complemento || null,
        bairro: addrForm.bairro || null,
        cidade: addrForm.cidade || null,
        estado: addrForm.estado || null,
        cep: addrForm.cep || null,
        is_principal: enderecos.length === 0,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { alert("Erro: " + (json?.error ?? "falha")); return; }
    setAddrForm(EMPTY_ADDR);
    setShowAddrForm(false);
    await loadDetail(selected);
  };

  const setPrincipal = async (addrId: string) => {
    if (!selected) return;
    await fetch(`/api/admin/customers/${encodeURIComponent(selected.id)}/addresses`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address_id: addrId, action: "set_principal" }),
    });
    await loadDetail(selected);
  };

  const deleteAddr = async (addrId: string) => {
    if (!selected) return;
    await fetch(
      `/api/admin/customers/${encodeURIComponent(selected.id)}/addresses?address_id=${encodeURIComponent(addrId)}`,
      { method: "DELETE", credentials: "include" }
    );
    setEnderecos(p => p.filter(e => e.id !== addrId));
  };

  const markPaid = async (debtId: string) => {
    const debt = dividas.find(d => d.id === debtId);
    if (!debt) return;
    const res = await fetch("/api/admin/financeiro/bills", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: debtId,
        pay_amount: debt.saldo_devedor,
        original_amount: debt.original_amount,
        saldo_devedor: debt.saldo_devedor,
        payment_method: "pix",
        received_at: new Date().toISOString().slice(0, 10),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { alert("Erro: " + (json?.error ?? "falha")); return; }
    setDividas(p => p.map(d => d.id === debtId ? { ...d, status: "paid", saldo_devedor: 0, paid_at: new Date().toISOString() } : d));
    if (selected) {
      const r2 = await fetch(`/api/admin/customers/${encodeURIComponent(selected.id)}`, { credentials: "include", cache: "no-store" });
      const j2 = await r2.json().catch(() => ({}));
      if (r2.ok && j2.saldo_devedor != null) {
        const sd = Number(j2.saldo_devedor);
        setSelected(p => p ? { ...p, saldo_devedor: sd } : p);
        setCustomers(p => p.map(c => c.id === selected.id ? { ...c, saldo_devedor: sd } : c));
      }
    }
  };

  const emptyListMessage = search ? "Nenhum resultado." : "Nenhum cliente ainda.";

  let customerListPanelContent: React.ReactNode;
  if (loading) {
    customerListPanelContent = <CustomerListSkeleton />;
  } else if (filtered.length === 0) {
    customerListPanelContent = (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-400">
        <Users className="h-10 w-10" />
        <p className="text-sm">{emptyListMessage}</p>
      </div>
    );
  } else {
    customerListPanelContent = (
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => loadDetail(c)}
            className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${
              selected?.id === c.id ? "bg-violet-50 dark:bg-violet-900/20 border-l-2 border-violet-500" : ""
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600">
              <User className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {c.name ?? "Sem nome"}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">{c.phone ?? "—"}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {c.saldo_devedor > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  {brl(c.saldo_devedor)}
                </span>
              )}
              {c.limite_credito > 0 && c.saldo_devedor === 0 && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                  Crédito OK
                </span>
              )}
              <span className="text-[10px] text-zinc-400">{fmtDate(c.created_at)}</span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-hidden">

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Clientes</h1>
          <p className="mt-0.5 text-xs text-zinc-400">{summary.total} cadastrados</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar nome, fone, CPF…"
            className="w-64 rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-4 text-sm text-zinc-800 placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
        </div>
        <button type="button" onClick={openNew}
          className="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 shadow-[0_0_14px_rgba(249,115,22,0.35)] transition-all">
          <Plus className="h-4 w-4" /> Novo Cliente
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total",        value: summary.total,                      icon: Users,         color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-900/20"  },
          { label: "Com crédito",  value: summary.comCredito,                 icon: CreditCard,    color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
          { label: "Inadimplente", value: summary.inadimplente,               icon: AlertCircle,   color: "text-red-500",     bg: "bg-red-50 dark:bg-red-900/20"        },
          { label: "Total fiado",  value: brl(summary.totalDivida),           icon: TrendingDown,  color: "text-orange-500",  bg: "bg-orange-50 dark:bg-orange-900/20"  },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`flex items-center gap-3 rounded-xl p-4 ${bg} border border-zinc-100 dark:border-zinc-800 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-zinc-900 ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-black text-zinc-900 dark:text-zinc-50">{value}</p>
              <p className="text-[11px] text-zinc-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden min-h-0">

        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:w-[420px] lg:shrink-0">
          {customerListPanelContent}
        </div>

        {selected ? (
          <div className="hidden flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:flex min-w-0">

            <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30 text-violet-600">
                <User className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-900 dark:text-zinc-50 truncate">{selected.name ?? "—"}</p>
                <p className="text-xs text-zinc-500">{selected.phone ?? ""} · {selected.origem ?? "chatbot"}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => openEdit(selected)}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 transition-colors">
                  <Edit2 className="h-3.5 w-3.5" /> Editar
                </button>
                <button type="button" onClick={() => deleteCustomer(selected.id)}
                  className="rounded-xl border border-zinc-200 p-1.5 text-zinc-500 hover:border-red-300 hover:text-red-500 dark:border-zinc-700 dark:text-zinc-400 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-zinc-200 p-1.5 text-zinc-400 hover:text-zinc-700 dark:border-zinc-700 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {selected.limite_credito > 0 && (
              <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-800 px-5 py-3 flex items-center gap-6">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Limite</p>
                  <p className="text-lg font-black text-zinc-900 dark:text-zinc-50">{brl(selected.limite_credito)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Utilizado</p>
                  <p className={`text-lg font-black ${selected.saldo_devedor > 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {brl(selected.saldo_devedor)}
                  </p>
                </div>
                <div className="flex-1">
                  <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${selected.saldo_devedor / selected.limite_credito > 0.8 ? "bg-red-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, (selected.saldo_devedor / selected.limite_credito) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-400 text-right">
                    {brl(Math.max(0, selected.limite_credito - selected.saldo_devedor))} disponível
                  </p>
                </div>
              </div>
            )}

            <div className="flex shrink-0 gap-1 border-b border-zinc-100 px-5 dark:border-zinc-800">
              {(["info","enderecos","dividas"] as const).map(tab => (
                <button key={tab} type="button" onClick={() => setDetailTab(tab)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                    detailTab === tab
                      ? "border-violet-500 text-violet-600 dark:text-violet-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}>
                  {detailTabLabel(tab, enderecos.length, dividasOpenCount)}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">

              {detailTab === "info" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  {[
                    { label: "Nome",        value: selected.name,       icon: User    },
                    { label: "Telefone",    value: selected.phone,      icon: Phone   },
                    { label: "E-mail",      value: selected.email,      icon: Mail    },
                    { label: "CPF/CNPJ",    value: selected.cpf_cnpj,   icon: FileText },
                    { label: "Tipo",        value: selected.tipo_pessoa === "PJ" ? "Pessoa Jurídica" : "Pessoa Física", icon: User },
                    { label: "Bairro",      value: selected.neighborhood, icon: MapPin },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className="h-3 w-3 text-zinc-400" />
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{value ?? "—"}</p>
                    </div>
                  ))}
                  {selected.notes && (
                    <div className="col-span-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Observações</p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">{selected.notes}</p>
                    </div>
                  )}
                  <div className="col-span-2 text-[11px] text-zinc-400">
                    Cadastrado via <strong>{selected.origem ?? "chatbot"}</strong> em {fmtDate(selected.created_at)}
                    {selected.is_adult && " · ✅ Maior de idade confirmado"}
                  </div>
                </div>
              )}

              {detailTab === "enderecos" && (
                <div className="flex flex-col gap-3">
                  <button type="button" onClick={() => { setAddrForm(EMPTY_ADDR); setShowAddrForm(true); }}
                    className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-xs font-medium text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700 transition-colors">
                    <Plus className="h-3.5 w-3.5" /> Adicionar endereço
                  </button>
                  {enderecos.map(e => (
                    <div key={e.id} className={`rounded-xl border p-4 ${e.is_principal ? "border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20" : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Home className="h-4 w-4 text-violet-500 shrink-0" />
                          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{e.apelido}</span>
                          {e.is_principal && <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold text-white">Principal</span>}
                        </div>
                        <div className="flex gap-1.5">
                          {!e.is_principal && (
                            <button type="button" onClick={() => setPrincipal(e.id)}
                              className="rounded-lg border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700 transition-colors">
                              Tornar principal
                            </button>
                          )}
                          <button type="button" onClick={() => deleteAddr(e.id)} className="text-zinc-400 hover:text-red-500 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                        {[e.logradouro, e.numero && `nº ${e.numero}`, e.complemento, e.bairro, e.cidade, e.estado].filter(Boolean).join(", ")}
                        {e.cep && <span className="ml-2 text-zinc-400">CEP {e.cep}</span>}
                      </p>
                    </div>
                  ))}
                  {enderecos.length === 0 && (
                    <p className="text-center text-sm text-zinc-400 py-8">Nenhum endereço cadastrado.</p>
                  )}
                </div>
              )}

              {detailTab === "dividas" && (
                <div className="flex flex-col gap-3">
                  {dividas.length === 0 ? (
                    <p className="text-center text-sm text-zinc-400 py-8">Sem contas a prazo.</p>
                  ) : (
                    dividas.map((d) => (
                      <DebtListItem key={d.id} d={d} onMarkPaid={markPaid} />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 lg:flex">
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <User className="h-10 w-10" />
              <p className="text-sm">Selecione um cliente para ver os detalhes</p>
            </div>
          </div>
        )}
      </div>

      <CustomerFormModal
        open={showForm}
        editingId={editingId}
        form={form}
        setForm={setForm}
        saving={saving}
        onClose={() => setShowForm(false)}
        onSave={saveCustomer}
      />

      <AddressFormModal
        open={showAddrForm}
        addrForm={addrForm}
        setAddrForm={setAddrForm}
        cepLoading={cepLoading}
        onCepChange={handleCepChange}
        onClose={() => setShowAddrForm(false)}
        onSave={saveAddress}
      />
    </div>
  );
}
