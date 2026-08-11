"use client";

/**
 * Modal de montagem/edição de carrinho dentro do WhatsApp Inbox — atendente
 * ajusta itens, endereço estruturado e pagamento sem sair da conversa, e
 * dispara "Enviar para confirmação" (o cliente confirma pelo próprio
 * WhatsApp, sem IA envolvida — ver resolvePendingOrderConfirmation.ts).
 *
 * Reaproveita as mesmas peças da tela Pedidos (VariantResultRow, CartRow,
 * helpers de formatação) só que sem o seletor de cliente cadastrado do
 * `OrderForm` — aqui o cliente já é fixo (o contato da thread), então o
 * formulário fica mais simples: nome/telefone read-only + endereço
 * estruturado (obrigatório pra validar/entregar) + busca de produto + pagamento.
 */

import React, { useEffect, useState } from "react";
import Modal from "@/lib/orders/Modal";
import VariantResultRow from "@/lib/orders/VariantResultRow";
import CartRow from "@/lib/orders/CartRow";
import {
    brlToNumber,
    buildVariantTexts,
    cartSubtotal,
    cartTotalPreview,
    formatBRL,
    formatBRLInput,
} from "@/lib/orders/helpers";
import type { CartItem, DraftQty, PaymentMethod, Variant } from "@/lib/orders/types";
import type { ActiveCart } from "@/lib/whatsapp/types";
import { Search } from "lucide-react";

type ModalPaymentMethod = "pix" | "cash" | "card";

type AddressForm = {
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
};

const EMPTY_ADDRESS: AddressForm = {
    logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "",
};

const inputCls =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500";
const sectionCls = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const labelCls = "mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

function asCurrency(n: number): number {
    return Number((n || 0).toFixed(2));
}

export default function CartEditModal({
    open,
    onClose,
    threadId,
    customerName,
    customerPhone,
    initialCart,
    onSent,
}: {
    open: boolean;
    onClose: () => void;
    threadId: string;
    customerName: string | null;
    customerPhone: string | null;
    /** Carrinho já existente (bot/abandonado) pra pré-preencher, ou null pra montar do zero. */
    initialCart: ActiveCart | null;
    onSent: () => void;
}) {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [addr, setAddr] = useState<AddressForm>(EMPTY_ADDRESS);
    const [paymentMethod, setPaymentMethod] = useState<ModalPaymentMethod>("pix");
    const [changeFor, setChangeFor] = useState("0,00");
    const [deliveryFeeEnabled, setDeliveryFeeEnabled] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState("0,00");

    const [q, setQ] = useState("");
    const [results, setResults] = useState<Variant[]>([]);
    const [searching, setSearching] = useState(false);
    const [draftQty, setDraftQty] = useState<Record<string, DraftQty>>({});

    const [sending, setSending] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setMsg(null);
        setQ("");
        setResults([]);
        setDraftQty({});

        if (initialCart) {
            setCart(
                initialCart.items.map((it) => ({
                    variant: {
                        id: it.produtoEmbalagemId,
                        unit_price: it.unitPrice,
                        unit_embalagem_id: it.produtoEmbalagemId,
                        products: { name: it.sigla && it.sigla !== "UN" ? `${it.productName} (${it.sigla})` : it.productName },
                    },
                    qty: it.quantity,
                    price: it.unitPrice,
                    mode: "unit" as const,
                }))
            );
            const a = initialCart.address;
            setAddr({
                logradouro: a?.logradouro ?? "",
                numero: a?.numero ?? "",
                complemento: a?.complemento ?? "",
                bairro: a?.bairro ?? "",
                cidade: a?.cidade ?? "",
                estado: a?.estado ?? "",
                cep: "",
            });
            setPaymentMethod(initialCart.paymentMethod ?? "pix");
            const fee = Math.max(0, asCurrency(initialCart.grandTotal - initialCart.totalItems));
            setDeliveryFeeEnabled(fee > 0);
            setDeliveryFee(formatBRL(fee));
        } else {
            setCart([]);
            setAddr(EMPTY_ADDRESS);
            setPaymentMethod("pix");
            setDeliveryFeeEnabled(false);
            setDeliveryFee("0,00");
        }
    }, [open, initialCart]);

    function getDraft(id: string): DraftQty {
        return draftQty[id] ?? { unit: "", box: "" };
    }
    function setDraft(id: string, patch: Partial<DraftQty>) {
        setDraftQty((prev) => ({ ...prev, [id]: { ...getDraft(id), ...patch } }));
    }
    function clearDraft(id: string) {
        setDraftQty((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }

    async function runSearch(text: string) {
        setQ(text);
        setMsg(null);
        if (text.trim().length < 2) { setResults([]); return; }
        setSearching(true);
        try {
            const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(text.trim())}`, {
                cache: "no-store",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            setResults(res.ok ? ((json.variants ?? []) as Variant[]) : []);
        } finally {
            setSearching(false);
        }
    }

    function addToCart(v: Variant, mode: "unit" | "case", qty: number) {
        const qAdd = Math.max(0, qty || 0);
        if (qAdd <= 0) return;
        const price = mode === "case" ? Number(v.case_price ?? 0) : Number(v.unit_price ?? 0);
        setCart((prev) => {
            const idx = prev.findIndex((i) => i.variant.id === v.id && i.mode === mode);
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], qty: copy[idx].qty + qAdd };
                return copy;
            }
            return [...prev, { variant: v, qty: qAdd, price, mode }];
        });
    }

    const totalNow = cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee);
    const customerPaysNow = brlToNumber(changeFor);
    const trocoNow = Math.max(0, customerPaysNow - totalNow);

    async function handleSend() {
        setMsg(null);
        if (cart.length === 0) { setMsg("Adicione pelo menos um item ao carrinho."); return; }
        if (!addr.logradouro.trim() || !addr.numero.trim() || !addr.bairro.trim() || !addr.cidade.trim() || addr.estado.trim().length < 2) {
            setMsg("Preencha o endereço completo (rua, número, bairro, cidade e UF).");
            return;
        }
        setSending(true);
        try {
            const items = cart.map((c) => {
                const embalagemId =
                    c.mode === "unit" ? (c.variant.unit_embalagem_id ?? c.variant.id) : (c.variant.case_embalagem_id ?? c.variant.id);
                return {
                    produtoEmbalagemId: String(embalagemId),
                    productName: buildVariantTexts(c.variant).displayName,
                    quantity: c.qty,
                    unitPrice: c.price,
                };
            });
            const res = await fetch(`/api/whatsapp/threads/${threadId}/cart/send-confirmation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    items,
                    address: addr,
                    paymentMethod,
                    changeFor: paymentMethod === "cash" ? brlToNumber(changeFor) : null,
                    deliveryFee: deliveryFeeEnabled ? brlToNumber(deliveryFee) : 0,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(`Erro ao enviar: ${json?.error ?? json?.message ?? "falha desconhecida"}`);
                return;
            }
            onSent();
            onClose();
        } catch {
            setMsg("Erro de conexão ao enviar. Tente novamente.");
        } finally {
            setSending(false);
        }
    }

    return (
        <Modal title="Montar carrinho" open={open} onClose={onClose} zClass="z-[10000]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                {/* ── Cliente (fixo pela thread) ── */}
                <div className={`${sectionCls} sm:col-span-2`}>
                    <div className={labelCls}>Cliente</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm">
                        <p className="text-zinc-700 dark:text-zinc-300"><span className="font-semibold">Nome:</span> {customerName || "—"}</p>
                        <p className="text-zinc-700 dark:text-zinc-300"><span className="font-semibold">WhatsApp:</span> {customerPhone || "—"}</p>
                    </div>
                </div>

                {/* ── Endereço ── */}
                <div className={`${sectionCls} sm:col-span-2`}>
                    <div className={labelCls}>Endereço de entrega</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input placeholder="Logradouro *" value={addr.logradouro} onChange={(e) => setAddr((p) => ({ ...p, logradouro: e.target.value }))} className={`${inputCls} sm:col-span-2`} />
                        <input placeholder="Número *" value={addr.numero} onChange={(e) => setAddr((p) => ({ ...p, numero: e.target.value }))} className={inputCls} />
                        <input placeholder="Complemento" value={addr.complemento} onChange={(e) => setAddr((p) => ({ ...p, complemento: e.target.value }))} className={inputCls} />
                        <input placeholder="Bairro *" value={addr.bairro} onChange={(e) => setAddr((p) => ({ ...p, bairro: e.target.value }))} className={inputCls} />
                        <input placeholder="CEP" value={addr.cep} onChange={(e) => setAddr((p) => ({ ...p, cep: e.target.value }))} className={inputCls} />
                        <input placeholder="Cidade *" value={addr.cidade} onChange={(e) => setAddr((p) => ({ ...p, cidade: e.target.value }))} className={inputCls} />
                        <input placeholder="UF *" value={addr.estado} onChange={(e) => setAddr((p) => ({ ...p, estado: e.target.value.toUpperCase().slice(0, 2) }))} className={inputCls} />
                    </div>
                </div>

                {/* ── Pagamento ── */}
                <div className={sectionCls}>
                    <div className={labelCls}>Pagamento</div>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as ModalPaymentMethod)} className={inputCls}>
                        <option value="pix">PIX</option>
                        <option value="card">Cartão</option>
                        <option value="cash">Dinheiro</option>
                    </select>
                    {paymentMethod === "cash" && (
                        <div className="mt-3 space-y-2">
                            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Cliente paga com (R$)</label>
                            <input value={changeFor} onChange={(e) => setChangeFor(formatBRLInput(e.target.value))} className={inputCls} inputMode="numeric" />
                            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50">
                                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-50">Troco: R$ {formatBRL(trocoNow)}</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Entrega ── */}
                <div className={sectionCls}>
                    <div className={labelCls}>Entrega</div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        <input type="checkbox" checked={deliveryFeeEnabled} onChange={(e) => setDeliveryFeeEnabled(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500" />
                        Cobrar taxa de entrega
                    </label>
                    <div className="mt-3 space-y-1">
                        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Taxa (R$)</label>
                        <input value={deliveryFee} onChange={(e) => setDeliveryFee(formatBRLInput(e.target.value))} disabled={!deliveryFeeEnabled} className={`${inputCls} disabled:opacity-50`} inputMode="numeric" />
                    </div>
                </div>

                {/* ── Adicionar itens ── */}
                <div className={`${sectionCls} sm:col-span-2`}>
                    <div className={labelCls}>Adicionar itens</div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                        <input
                            placeholder="Buscar por categoria, marca, detalhes, volume..."
                            value={q}
                            onChange={(e) => runSearch(e.target.value)}
                            className={`${inputCls} pl-9`}
                        />
                    </div>
                    <div className="mt-3">
                        {searching ? (
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">Buscando...</p>
                        ) : results.length === 0 ? (
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">Digite pelo menos 2 letras para buscar.</p>
                        ) : (
                            <div className="grid gap-2">
                                {results.map((v) => (
                                    <VariantResultRow
                                        key={v.id}
                                        v={v}
                                        draft={getDraft(v.id)}
                                        onDraftChange={(patch) => setDraft(v.id, patch)}
                                        onAdd={(unitN, boxN) => {
                                            if (unitN > 0) addToCart(v, "unit", unitN);
                                            if (boxN > 0 && v.has_case && v.case_price) addToCart(v, "case", boxN);
                                            clearDraft(v.id);
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Carrinho ── */}
                <div className={`${sectionCls} sm:col-span-2`}>
                    <div className={labelCls}>Carrinho</div>
                    {cart.length === 0 ? (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">Nenhum item adicionado.</p>
                    ) : (
                        <div className="grid gap-2">
                            {cart.map((item, idx) => (
                                <CartRow
                                    key={`${item.variant.id}-${item.mode}-${idx}`}
                                    item={item}
                                    onDec={() => setCart((prev) => { const c = [...prev]; c[idx] = { ...c[idx], qty: Math.max(1, c[idx].qty - 1) }; return c; })}
                                    onInc={() => setCart((prev) => { const c = [...prev]; c[idx] = { ...c[idx], qty: c[idx].qty + 1 }; return c; })}
                                    onRemove={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
                                />
                            ))}
                        </div>
                    )}
                    <div className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                        <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                            <span>Subtotal</span>
                            <span className="font-semibold">R$ {formatBRL(cartSubtotal(cart))}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-50">Total</span>
                            <span className="font-bold text-violet-700 dark:text-violet-400">R$ {formatBRL(totalNow)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-4 flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <button
                    onClick={handleSend}
                    disabled={sending}
                    className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {sending ? "Enviando..." : "Enviar para confirmação"}
                </button>
                <button
                    onClick={onClose}
                    disabled={sending}
                    className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                    Cancelar
                </button>
                {msg && <span className="ml-auto text-xs font-medium text-rose-600">{msg}</span>}
            </div>
            <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                O pedido só é criado depois que o cliente confirmar pelo WhatsApp (CONFIRMAR/CANCELAR).
            </p>
        </Modal>
    );
}
