"use client";

/**
 * Gaveta de carrinho no rodapé da conversa (WhatsApp Inbox) — o atendente monta
 * o pedido **sem** perder a conversa: não é dialog, não tem overlay nem focus
 * trap, e o composer continua utilizável enquanto a gaveta está aberta.
 *
 * Recolhida vira uma barra fina com o resumo do carrinho ativo do cliente.
 * Aberta, ocupa altura fixa no fim da coluna: a lista de mensagens encolhe
 * (flex) em vez de ficar coberta.
 *
 * Dois desfechos: "Enviar resumo" (cliente confirma pelo botão no WhatsApp, sem
 * IA — ver resolvePendingOrderConfirmation.ts) e "Finalizar pedido" (atendente
 * fecha na hora, cliente já deu o ok na conversa).
 *
 * Reaproveita as peças da tela Pedidos (VariantResultRow, CartRow, helpers) sem
 * o seletor de cliente: aqui o cliente é fixo (o contato da thread).
 */

import React, { useEffect, useState } from "react";
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
import type { CartItem, DraftQty, Variant } from "@/lib/orders/types";
import type { ActiveCart } from "@/lib/whatsapp/types";
import { ChevronDown, ChevronUp, Search, ShoppingCart } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type DrawerPaymentMethod = "pix" | "cash" | "card";

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

const PANEL_ID = "whatsapp-cart-drawer";

const inputCls =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500";
const sectionCls = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const labelCls = "mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

function asCurrency(n: number): number {
    return Number((n || 0).toFixed(2));
}

export default function CartDrawer({
    open,
    onOpenChange,
    threadId,
    customerName,
    customerPhone,
    initialCart,
    onSent,
}: Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    threadId: string;
    customerName: string | null;
    customerPhone: string | null;
    /** Carrinho já existente (bot/abandonado) pra pré-preencher, ou null pra montar do zero. */
    initialCart: ActiveCart | null;
    onSent: () => void;
}>) {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [addr, setAddr] = useState<AddressForm>(EMPTY_ADDRESS);
    const [paymentMethod, setPaymentMethod] = useState<DrawerPaymentMethod>("pix");
    const [changeFor, setChangeFor] = useState("0,00");
    const [deliveryFeeEnabled, setDeliveryFeeEnabled] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState("0,00");

    const [q, setQ] = useState("");
    const [results, setResults] = useState<Variant[]>([]);
    const [searching, setSearching] = useState(false);
    const [draftQty, setDraftQty] = useState<Record<string, DraftQty>>({});

    const [sending, setSending] = useState<"send-confirmation" | "finalize" | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    /** Rascunho recomeça a cada abertura e a cada troca de conversa. */
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
    }, [open, initialCart, threadId]);

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

    async function submitCart(action: "send-confirmation" | "finalize") {
        setMsg(null);
        if (cart.length === 0) { setMsg("Adicione pelo menos um item ao carrinho."); return; }
        if (!addr.logradouro.trim() || !addr.numero.trim() || !addr.bairro.trim() || !addr.cidade.trim() || addr.estado.trim().length < 2) {
            setMsg("Preencha o endereço completo (rua, número, bairro, cidade e UF).");
            return;
        }
        setSending(action);
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
            const res = await fetch(`/api/whatsapp/threads/${threadId}/cart/${action}`, {
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
                const prefix = action === "finalize" ? "Erro ao finalizar" : "Erro ao enviar";
                setMsg(`${prefix}: ${json?.error?.message ?? "falha desconhecida"}`);
                return;
            }
            onSent();
            onOpenChange(false);
        } catch {
            setMsg("Erro de conexão. Tente novamente.");
        } finally {
            setSending(null);
        }
    }

    if (!open) {
        const itemCount = initialCart?.items.reduce((s, it) => s + it.quantity, 0) ?? 0;
        return (
            <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-800">
                <button
                    type="button"
                    onClick={() => onOpenChange(true)}
                    aria-expanded={false}
                    aria-controls={PANEL_ID}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-zinc-800/50"
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <ShoppingCart className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
                        <span className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                            {itemCount > 0 ? "Carrinho do cliente" : "Montar carrinho"}
                        </span>
                        {itemCount > 0 && (
                            <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                {itemCount} {itemCount === 1 ? "item" : "itens"} · R$ {formatBRL(initialCart?.grandTotal ?? 0)}
                            </span>
                        )}
                    </span>
                    <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                </button>
            </div>
        );
    }

    return (
        <section
            id={PANEL_ID}
            aria-label="Carrinho do cliente"
            className="flex h-[min(55vh,26rem)] shrink-0 flex-col overflow-hidden border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
        >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="flex min-w-0 items-center gap-2">
                    <ShoppingCart className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
                    <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-50">Montar carrinho</span>
                    <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {cart.length} {cart.length === 1 ? "item" : "itens"} · Total R$ {formatBRL(totalNow)}
                    </span>
                </span>
                <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    aria-expanded
                    aria-controls={PANEL_ID}
                    aria-label="Recolher carrinho"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-zinc-800"
                >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">

                    {/* ── Cliente (fixo pela thread) ── */}
                    <div className={`${sectionCls} lg:col-span-2`}>
                        <div className={labelCls}>Cliente</div>
                        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                            <p className="truncate text-zinc-700 dark:text-zinc-300"><span className="font-semibold">Nome:</span> {customerName || "—"}</p>
                            <p className="truncate text-zinc-700 dark:text-zinc-300"><span className="font-semibold">WhatsApp:</span> {customerPhone || "—"}</p>
                        </div>
                    </div>

                    {/* ── Endereço ── */}
                    <div className={`${sectionCls} lg:col-span-2`}>
                        <div className={labelCls}>Endereço de entrega</div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                        <Select
                            value={paymentMethod}
                            onValueChange={(v) => setPaymentMethod(v as DrawerPaymentMethod)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pix">PIX</SelectItem>
                                <SelectItem value="card">Cartão</SelectItem>
                                <SelectItem value="cash">Dinheiro</SelectItem>
                            </SelectContent>
                        </Select>
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
                    <div className={sectionCls}>
                        <div className={labelCls}>Adicionar itens</div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                            <input
                                placeholder="Buscar por categoria, marca, volume..."
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
                                <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
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
                    <div className={sectionCls}>
                        <div className={labelCls}>Carrinho</div>
                        {cart.length === 0 ? (
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">Nenhum item adicionado.</p>
                        ) : (
                            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
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

                <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                    <strong>Enviar resumo:</strong> manda o resumo com os botões Confirmar/Cancelar e
                    religa o chatbot — o pedido nasce quando o cliente tocar em Confirmar.{" "}
                    <strong>Finalizar pedido:</strong> cria o pedido agora (cliente já deu o ok na
                    conversa) e avisa o cliente no WhatsApp.
                </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                <button
                    type="button"
                    onClick={() => void submitCart("send-confirmation")}
                    disabled={sending !== null}
                    className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {sending === "send-confirmation" ? "Enviando..." : "Enviar resumo"}
                </button>
                <button
                    type="button"
                    onClick={() => void submitCart("finalize")}
                    disabled={sending !== null}
                    className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {sending === "finalize" ? "Finalizando..." : "Finalizar pedido"}
                </button>
                {msg && <span className="text-xs font-medium text-rose-600">{msg}</span>}
            </div>
        </section>
    );
}
