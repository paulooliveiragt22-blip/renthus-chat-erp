// app/(admin)/entregadores/page.tsx
"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    Bike, CheckCircle2, Loader2, Pencil, Phone,
    Plus, RefreshCw, Search, ToggleLeft, ToggleRight, Trash2, User, X,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type Driver = {
    id:         string;
    company_id: string;
    name:       string;
    phone:      string | null;
    vehicle:    string | null;
    plate:      string | null;
    is_active:  boolean;
    notes:      string | null;
    created_at: string;
};

type FormState = {
    name:    string;
    phone:   string;
    vehicle: string;
    plate:   string;
    notes:   string;
};

const emptyForm: FormState = { name: "", phone: "", vehicle: "", plate: "", notes: "" };

// ─── sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50";

function Modal({ title, open, onClose, children }: Readonly<{ title: string; open: boolean; onClose: () => void; children: React.ReactNode }>) {
    const titleId = React.useId();
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open) {
            if (!el.open) el.showModal();
        } else if (el.open) {
            el.close();
        }
    }, [open]);

    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900"
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                <h3 id={titleId} className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h3>
                <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="p-5">{children}</div>
        </dialog>
    );
}

function Skeleton() {
    return <div className="h-[72px] animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />;
}

function Field({ label, value, onChange, placeholder = "", hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
    const id = React.useId();
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</label>
            <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
            {hint && <p className="text-[11px] text-zinc-400">{hint}</p>}
        </div>
    );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function EntregadoresPage() {
    const { currentCompanyId: companyId } = useWorkspace();
    const notesFieldId = useId();

    const [drivers,  setDrivers]  = useState<Driver[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [search,   setSearch]   = useState("");
    const [msg,      setMsg]      = useState<string | null>(null);

    // modal
    const [open,     setOpen]     = useState(false);
    const [editing,  setEditing]  = useState<Driver | null>(null);
    const [form,     setForm]     = useState<FormState>(emptyForm);
    const [saving,   setSaving]   = useState(false);
    const [formMsg,  setFormMsg]  = useState<string | null>(null);

    // delete confirm
    const [delId,    setDelId]    = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    // flash
    const [flashId, setFlashId] = useState<string | null>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function flash(id: string) {
        setFlashId(id);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashId(null), 1500);
    }

    // ── load ─────────────────────────────────────────────────────────────────

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const res = await fetch("/api/admin/drivers", { cache: "no-store", credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(`Erro: ${json?.error ?? "falha ao carregar entregadores"}`); setLoading(false); return; }
        setDrivers((json.drivers as Driver[]) ?? []);
        setLoading(false);
    }, [companyId]);

    useEffect(() => { load(); }, [load]);

    // ── form helpers ──────────────────────────────────────────────────────────

    function openNew() {
        setEditing(null); setForm(emptyForm); setFormMsg(null); setOpen(true);
    }

    function openEdit(d: Driver) {
        setEditing(d);
        setForm({ name: d.name, phone: d.phone ?? "", vehicle: d.vehicle ?? "", plate: d.plate ?? "", notes: d.notes ?? "" });
        setFormMsg(null); setOpen(true);
    }

    function setField(key: keyof FormState, val: string) {
        setForm((prev) => ({ ...prev, [key]: val }));
    }

    async function save() {
        if (!companyId) return;
        if (!form.name.trim()) { setFormMsg("Nome obrigatório."); return; }
        setSaving(true); setFormMsg(null);

        if (editing) {
            const res = await fetch("/api/admin/drivers", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    id: editing.id,
                    name: form.name.trim(),
                    phone: form.phone.trim() || null,
                    vehicle: form.vehicle.trim() || null,
                    plate: form.plate.trim() || null,
                    notes: form.notes.trim() || null,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setFormMsg(`Erro: ${json?.error ?? "falha ao salvar"}`); setSaving(false); return; }
        } else {
            const res = await fetch("/api/admin/drivers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    name: form.name.trim(),
                    phone: form.phone.trim() || null,
                    vehicle: form.vehicle.trim() || null,
                    plate: form.plate.trim() || null,
                    notes: form.notes.trim() || null,
                    is_active: true,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setFormMsg(`Erro: ${json?.error ?? "falha ao cadastrar"}`); setSaving(false); return; }
            if (json?.driver?.id) flash(String(json.driver.id));
        }

        setSaving(false); setOpen(false); load();
    }

    // ── toggle active ─────────────────────────────────────────────────────────

    async function toggleActive(d: Driver) {
        const next = !d.is_active;
        setDrivers((prev) => prev.map((x) => x.id === d.id ? { ...x, is_active: next } : x));
        await fetch("/api/admin/drivers", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: d.id, is_active: next }),
        });
        flash(d.id);
    }

    // ── delete ────────────────────────────────────────────────────────────────

    async function confirmDelete() {
        if (!delId) return;
        setDeleting(true);
        await fetch("/api/admin/drivers", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: delId }),
        });
        setDrivers((prev) => prev.filter((d) => d.id !== delId));
        setDelId(null); setDeleting(false);
    }

    // ── filter ────────────────────────────────────────────────────────────────

    const filtered = drivers.filter((d) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return [d.name, d.phone ?? "", d.vehicle ?? "", d.plate ?? ""].some((x) => x.toLowerCase().includes(s));
    });

    const activeCount = drivers.filter((d) => d.is_active).length;

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Entregadores</h1>
                    <p className="mt-0.5 text-xs text-zinc-400">
                        {drivers.length} cadastrados · {activeCount} ativos
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={load} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <button type="button" onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600">
                        <Plus className="h-3.5 w-3.5" /> Novo Entregador
                    </button>
                </div>
            </div>

            {msg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4">
                {[
                    { label: "Total cadastrados", value: drivers.length, color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30" },
                    { label: "Ativos",             value: activeCount,    color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30" },
                ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                            <Bike className="h-5 w-5" />
                        </span>
                        <div>
                            <p className="text-xs text-zinc-400">{label}</p>
                            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{loading ? "…" : value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, telefone, veículo ou placa…"
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </div>

            {/* Driver cards */}
            <div className="flex flex-col gap-3">
                {loading
                    ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)
                    : filtered.length === 0
                    ? (
                        <div className="flex flex-col items-center gap-3 rounded-xl bg-white py-16 shadow-sm dark:bg-zinc-900">
                            <Bike className="h-10 w-10 text-zinc-300" />
                            <p className="text-sm text-zinc-400">{search ? "Nenhum resultado." : "Nenhum entregador cadastrado. Clique em + Novo Entregador."}</p>
                        </div>
                    )
                    : filtered.map((d) => (
                        <div
                            key={d.id}
                            className={`flex items-center justify-between rounded-xl border bg-white px-4 py-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${
                                flashId === d.id
                                    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/10"
                                    : d.is_active
                                    ? "border-zinc-100 hover:border-zinc-200 dark:border-zinc-800"
                                    : "border-zinc-100 opacity-60 dark:border-zinc-800"
                            }`}
                        >
                            {/* Avatar + info */}
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                                    <User className="h-5 w-5 text-violet-600" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{d.name}</p>
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${d.is_active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                                            {d.is_active ? "● Ativo" : "Inativo"}
                                        </span>
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                                        {d.phone && (
                                            <span className="flex items-center gap-1">
                                                <Phone className="h-3 w-3" /> {d.phone}
                                            </span>
                                        )}
                                        {d.vehicle && <span>🛵 {d.vehicle}</span>}
                                        {d.plate && <span className="font-mono text-zinc-500">{d.plate}</span>}
                                    </div>
                                    {d.notes && <p className="mt-0.5 text-xs text-zinc-400 italic">{d.notes}</p>}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 shrink-0 ml-3">
                                <button type="button" onClick={() => toggleActive(d)} title={d.is_active ? "Desativar" : "Ativar"}>
                                    {d.is_active
                                        ? <ToggleRight className="h-6 w-6 text-violet-600" />
                                        : <ToggleLeft  className="h-6 w-6 text-zinc-400" />}
                                </button>
                                <button type="button" onClick={() => openEdit(d)} className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 dark:border-zinc-700">
                                    <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => setDelId(d.id)} className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
            </div>

            {/* Create / Edit Modal */}
            <Modal title={editing ? `Editar: ${editing.name}` : "Novo Entregador"} open={open} onClose={() => setOpen(false)}>
                <div className="flex flex-col gap-4">
                    <Field label="Nome *" value={form.name} onChange={(v) => setField("name", v)} placeholder="Nome completo" />
                    <Field label="Telefone / WhatsApp" value={form.phone} onChange={(v) => setField("phone", v)} placeholder="(66) 9 9999-9999" hint="Com código do país para envio de WhatsApp." />
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Veículo" value={form.vehicle} onChange={(v) => setField("vehicle", v)} placeholder="Moto, Carro…" />
                        <Field label="Placa" value={form.plate} onChange={(v) => setField("plate", v)} placeholder="ABC-1234" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor={notesFieldId} className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Observações</label>
                        <textarea id={notesFieldId} value={form.notes} onChange={(e) => setField("notes", e.target.value)} rows={2} placeholder="Ex: Região norte, preferência noite…"
                            className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
                    </div>

                    {formMsg && <p className="text-xs font-semibold text-red-600">{formMsg}</p>}

                    <div className="flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <button type="button" onClick={save} disabled={saving}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {saving ? "Salvando…" : editing ? "Salvar alterações" : "Cadastrar entregador"}
                        </button>
                        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                    </div>
                </div>
            </Modal>

            {/* Delete confirm */}
            <Modal title="Confirmar exclusão" open={!!delId} onClose={() => setDelId(null)}>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Esta ação removerá permanentemente o entregador. Pedidos vinculados manterão o histórico, mas perderão o vínculo.</p>
                <div className="mt-5 flex gap-2">
                    <button type="button" onClick={confirmDelete} disabled={deleting}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
                        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        {deleting ? "Excluindo…" : "Sim, excluir"}
                    </button>
                    <button type="button" onClick={() => setDelId(null)} className="rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                </div>
            </Modal>
        </div>
    );
}
