// app/(admin)/suporte/SuporteClient.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    CheckCircle2,
    Clock,
    Headphones,
    MessageCircle,
    Phone,
    RefreshCcw,
    User,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

type Ticket = {
    id: string;
    company_id: string;
    customer_phone: string;
    customer_name: string | null;
    message: string | null;
    priority: TicketPriority;
    status: TicketStatus;
    attended_by: string | null;
    created_at: string;
    updated_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TicketStatus, string> = {
    open:        "Aberto",
    in_progress: "Em atendimento",
    resolved:    "Resolvido",
    closed:      "Fechado",
};

const STATUS_COLORS: Record<TicketStatus, string> = {
    open:        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    resolved:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    closed:      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
    low:    "Baixa",
    normal: "Normal",
    high:   "Alta",
    urgent: "Urgente",
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
    low:    "bg-zinc-100 text-zinc-600",
    normal: "bg-zinc-100 text-zinc-700",
    high:   "bg-orange-100 text-orange-700",
    urgent: "bg-red-100 text-red-700",
};

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString("pt-BR", {
        day:    "2-digit",
        month:  "2-digit",
        hour:   "2-digit",
        minute: "2-digit",
    });
}

function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 13) {
        return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    return phone;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SuporteClient() {
    const { currentCompanyId: companyId } = useWorkspace();
    const supabase       = createClient();

    const [tickets,    setTickets]    = useState<Ticket[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [statusFilter, setStatusFilter] = useState<TicketStatus | "all">("open");
    const [updating,   setUpdating]   = useState<string | null>(null);

    // ── Fetch ──────────────────────────────────────────────────────────────────

    const fetchTickets = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);

        let query = supabase
            .from("support_tickets")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(100);

        if (statusFilter !== "all") {
            query = query.eq("status", statusFilter);
        }

        const { data, error } = await query;

        if (error) {
            toast.error("Erro ao carregar tickets");
        } else {
            setTickets((data ?? []) as Ticket[]);
        }
        setLoading(false);
    }, [companyId, statusFilter, supabase]);

    useEffect(() => { fetchTickets(); }, [fetchTickets]);

    // ── Realtime ───────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!companyId) return;

        const channel = supabase
            .channel("support_tickets_realtime")
            .on(
                "postgres_changes",
                {
                    event:  "*",
                    schema: "public",
                    table:  "support_tickets",
                    filter: `company_id=eq.${companyId}`,
                },
                () => { fetchTickets(); }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [companyId, fetchTickets, supabase]);

    // ── Actions ────────────────────────────────────────────────────────────────

    async function updateStatus(ticketId: string, newStatus: TicketStatus) {
        setUpdating(ticketId);
        const { error } = await supabase
            .from("support_tickets")
            .update({ status: newStatus })
            .eq("id", ticketId);

        if (error) {
            toast.error("Erro ao atualizar ticket");
        } else {
            toast.success(`Ticket ${STATUS_LABELS[newStatus].toLowerCase()}`);
            setTickets((prev) =>
                prev.map((t) => t.id === ticketId ? { ...t, status: newStatus } : t)
            );
        }
        setUpdating(null);
    }

    // ── Stats ──────────────────────────────────────────────────────────────────

    const stats = {
        open:        tickets.filter((t) => t.status === "open").length,
        in_progress: tickets.filter((t) => t.status === "in_progress").length,
        resolved:    tickets.filter((t) => t.status === "resolved").length,
    };

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <main className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Headphones className="w-6 h-6 text-purple-600" />
                    <div>
                        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Suporte</h1>
                        <p className="text-sm text-zinc-500">Tickets de atendimento humano via WhatsApp</p>
                    </div>
                </div>
                <button
                    onClick={fetchTickets}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Atualizar
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: "Abertos",          value: stats.open,        color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
                    { label: "Em atendimento",    value: stats.in_progress, color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-900/20" },
                    { label: "Resolvidos (lista)", value: stats.resolved,    color: "text-green-600",  bg: "bg-green-50 dark:bg-green-900/20" },
                ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`${bg} rounded-xl p-4`}>
                        <p className="text-xs text-zinc-500 mb-1">{label}</p>
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
                {([
                    { id: "all"       as const, label: "Todos" },
                    { id: "open"        as const, label: "Abertos" },
                    { id: "in_progress" as const, label: "Em atendimento" },
                    { id: "resolved"    as const, label: "Resolvidos" },
                    { id: "closed"      as const, label: "Fechados" },
                ] as const).map(({ id, label }) => (
                    <button
                        key={id}
                        onClick={() => setStatusFilter(id)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            statusFilter === id
                                ? "bg-purple-600 text-white"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Ticket list */}
            {loading ? (
                <div className="text-center py-12 text-zinc-400">Carregando...</div>
            ) : tickets.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                    <MessageCircle className="w-10 h-10 text-zinc-300 mx-auto" />
                    <p className="text-zinc-500">Nenhum ticket encontrado</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {tickets.map((ticket) => (
                        <TicketCard
                            key={ticket.id}
                            ticket={ticket}
                            updating={updating === ticket.id}
                            onUpdateStatus={updateStatus}
                        />
                    ))}
                </div>
            )}
        </main>
    );
}

// ─── TicketCard ───────────────────────────────────────────────────────────────

function TicketCard({
    ticket,
    updating,
    onUpdateStatus,
}: {
    ticket:         Ticket;
    updating:       boolean;
    onUpdateStatus: (id: string, status: TicketStatus) => Promise<void>;
}) {
    return (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            {/* Top row */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[ticket.status]}`}>
                        {STATUS_LABELS[ticket.status]}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                        {PRIORITY_LABELS[ticket.priority]}
                    </span>
                </div>
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(ticket.created_at)}
                </span>
            </div>

            {/* Client info */}
            <div className="flex items-center gap-4 flex-wrap">
                <span className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                    <User className="w-4 h-4 text-zinc-400" />
                    {ticket.customer_name ?? "Cliente"}
                </span>
                <a
                    href={`https://wa.me/${ticket.customer_phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-green-600 hover:underline"
                >
                    <Phone className="w-4 h-4" />
                    {formatPhone(ticket.customer_phone)}
                </a>
            </div>

            {/* Message */}
            {ticket.message && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2 italic">
                    "{ticket.message}"
                </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap pt-1">
                {ticket.status === "open" && (
                    <ActionButton
                        icon={<Headphones className="w-3.5 h-3.5" />}
                        label="Iniciar atendimento"
                        color="blue"
                        disabled={updating}
                        onClick={() => onUpdateStatus(ticket.id, "in_progress")}
                    />
                )}
                {(ticket.status === "open" || ticket.status === "in_progress") && (
                    <ActionButton
                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        label="Resolver"
                        color="green"
                        disabled={updating}
                        onClick={() => onUpdateStatus(ticket.id, "resolved")}
                    />
                )}
                {ticket.status !== "closed" && (
                    <ActionButton
                        icon={<XCircle className="w-3.5 h-3.5" />}
                        label="Fechar"
                        color="zinc"
                        disabled={updating}
                        onClick={() => onUpdateStatus(ticket.id, "closed")}
                    />
                )}
            </div>
        </div>
    );
}

function ActionButton({
    icon, label, color, disabled, onClick,
}: {
    icon:     React.ReactNode;
    label:    string;
    color:    "blue" | "green" | "zinc";
    disabled: boolean;
    onClick:  () => void;
}) {
    const colors = {
        blue:  "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300",
        green: "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300",
        zinc:  "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${colors[color]}`}
        >
            {icon}
            {label}
        </button>
    );
}
