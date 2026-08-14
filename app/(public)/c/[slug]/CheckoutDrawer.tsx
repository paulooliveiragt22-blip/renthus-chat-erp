"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
    PublicMenuCartLine,
    PublicMenuCheckoutResult,
    PublicMenuNewAddressInput,
    PublicMenuSavedAddress,
    PublicMenuSessionOk,
} from "@/src/types/contracts.public-menu";
import { saveStoredMenuSession } from "@/lib/public-menu/sessionStorage";
import { formatPackSiglaLabel } from "@/lib/products/packDisplayName";
import { nextMenuCheckoutStep } from "@/lib/delivery/fulfillment";
import type { FulfillmentType } from "@/lib/delivery/fulfillment";
import {
    deliveryMinOrderCardLine,
    deliveryMinOrderHint,
    soleFulfillmentNotice,
} from "@/lib/delivery/fulfillmentCopy";

function formatBRL(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Step =
    | "cart"
    | "identify"
    | "fulfillment"
    | "mode_notice"
    | "address"
    | "payment"
    | "done";

type Props = {
    slug: string;
    storeName: string;
    deliveriesEnabled: boolean;
    pickupEnabled: boolean;
    /** Pedido mínimo base da loja (pode ser refinado pelo delivery-quote). */
    deliveryMinOrder: number | null;
    storeIsOpen: boolean;
    storeClosedHint: string | null;
    cart: PublicMenuCartLine[];
    onClose: () => void;
    onClearCart: () => void;
    onInc: (embalagemId: string) => void;
    onDec: (embalagemId: string) => void;
    onRemove: (embalagemId: string) => void;
    onAddMore: () => void;
};

const emptyAddress: PublicMenuNewAddressInput = {
    apelido: "Casa",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    cep: "",
};

export default function CheckoutDrawer({
    slug,
    storeName,
    deliveriesEnabled,
    pickupEnabled,
    deliveryMinOrder,
    storeIsOpen,
    storeClosedHint,
    cart,
    onClose,
    onClearCart,
    onInc,
    onDec,
    onRemove,
    onAddMore,
}: Props) {
    const [step, setStep] = useState<Step>("cart");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [sessionToken, setSessionToken] = useState<string | null>(null);
    const [needsPhone, setNeedsPhone] = useState(false);
    const [wmTokenFromUrl, setWmTokenFromUrl] = useState<string | null>(null);
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [isNewCustomer, setIsNewCustomer] = useState(false);
    const [addresses, setAddresses] = useState<PublicMenuSavedAddress[]>([]);

    const [addressMode, setAddressMode] = useState<"saved" | "new">("new");
    const [savedAddressId, setSavedAddressId] = useState<string | null>(null);
    const [newAddress, setNewAddress] = useState<PublicMenuNewAddressInput>(emptyAddress);
    const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
    const [deliveryMsg, setDeliveryMsg] = useState<string | null>(null);
    /** Mínimo efetivo do quote (bairro); cai no da loja se ainda não cotou. */
    const [quotedMinOrder, setQuotedMinOrder] = useState<number | null>(null);

    const [paymentMethod, setPaymentMethod] = useState<"pix" | "cash" | "card">("pix");
    const [changeFor, setChangeFor] = useState("");
    const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType | null>(() => {
        if (deliveriesEnabled && !pickupEnabled) return "delivery";
        if (!deliveriesEnabled && pickupEnabled) return "pickup";
        return null;
    });
    const [orderResult, setOrderResult] = useState<Extract<
        PublicMenuCheckoutResult,
        { ok: true }
    > | null>(null);

    /** Uma chave por tentativa — retry/double-click reusa; pós-sucesso gera outra. */
    const checkoutAttemptKeyRef = useRef<string | null>(null);

    function ensureCheckoutAttemptKey(): string {
        if (!checkoutAttemptKeyRef.current) {
            if (globalThis.crypto?.randomUUID) {
                checkoutAttemptKeyRef.current = globalThis.crypto.randomUUID();
            } else {
                checkoutAttemptKeyRef.current = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
                    /[xy]/g,
                    (ch) => {
                        const r = (Math.random() * 16) | 0;
                        const v = ch === "x" ? r : (r & 0x3) | 0x8;
                        return v.toString(16);
                    }
                );
            }
        }
        return checkoutAttemptKeyRef.current;
    }

    const subtotal = useMemo(
        () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
        [cart]
    );

    const effectiveMinOrder = quotedMinOrder ?? deliveryMinOrder;
    const minHint = deliveryMinOrderHint(subtotal, effectiveMinOrder);
    const deliveryCardMinLine = deliveryMinOrderCardLine(effectiveMinOrder);
    const soleNotice =
        fulfillmentType === "pickup" || fulfillmentType === "delivery"
            ? soleFulfillmentNotice(fulfillmentType)
            : null;

    function choosePickup() {
        setError(null);
        setFulfillmentType("pickup");
        setDeliveryFee(0);
        setDeliveryMsg(null);
        setStep("payment");
    }

    function chooseDelivery() {
        setError(null);
        setFulfillmentType("delivery");
        setStep("address");
    }

    useEffect(() => {
        const params = new URLSearchParams(globalThis.location.search);
        const wm = params.get("wm");
        if (!wm) return;
        setWmTokenFromUrl(wm);
        let cancelled = false;
        setBusy(true);
        void fetch(`/api/public/menu/${encodeURIComponent(slug)}/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wmToken: wm }),
        })
            .then(async (res) => {
                const json = (await res.json()) as PublicMenuSessionOk | { ok: false; error: string };
                if (cancelled) return;
                if (!json.ok) {
                    setError("Não foi possível identificar seu cadastro. Informe telefone e nome.");
                    return;
                }
                applySession(json);
                // Mantém no carrinho — não pula para endereço
            })
            .catch(() => {
                if (!cancelled) setError("Falha ao carregar seus dados.");
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    function applySession(json: PublicMenuSessionOk) {
        const phonePending = Boolean(json.needsPhone || json.customer.needsPhone);
        setNeedsPhone(phonePending);
        setSessionToken(phonePending ? null : json.sessionToken);
        setCustomerName(json.customer.name ?? "");
        setCustomerPhone(json.customer.phoneE164 || "");
        setIsNewCustomer(json.customer.isNew || phonePending);
        setAddresses(phonePending ? [] : json.addresses);
        if (!phonePending) {
            saveStoredMenuSession(slug, {
                sessionToken: json.sessionToken,
                customerName: json.customer.name,
                phoneE164: json.customer.phoneE164,
            });
        }
        if (!phonePending && json.addresses.length > 0) {
            setAddressMode("saved");
            const principal =
                json.addresses.find((a) => a.isPrincipal) ?? json.addresses[0]!;
            setSavedAddressId(principal.id);
            void quoteDelivery({ sessionToken: json.sessionToken, savedAddressId: principal.id });
        } else {
            setAddressMode("new");
            setSavedAddressId(null);
        }
    }

    const fulfillmentPolicy = { deliveriesEnabled, pickupEnabled };

    function goAfterIdentify() {
        const next = nextMenuCheckoutStep(fulfillmentPolicy);
        if (next === "unavailable") {
            setError("A loja não está aceitando pedidos de entrega nem de retirada no momento.");
            return;
        }
        if (next === "fulfillment") {
            setStep("fulfillment");
            return;
        }
        if (next === "sole_pickup") {
            setFulfillmentType("pickup");
            setDeliveryFee(0);
            setDeliveryMsg(null);
            setStep("mode_notice");
            return;
        }
        if (next === "sole_delivery") {
            setFulfillmentType("delivery");
            setStep("mode_notice");
            return;
        }
        // Fallback legado (não deve ocorrer com nextMenuCheckoutStep atual)
        setFulfillmentType("delivery");
        setStep("address");
    }

    function continueFromCart() {
        setError(null);
        if (cart.length === 0) {
            setError("Adicione pelo menos um item ao pedido.");
            return;
        }
        if (!storeIsOpen) {
            setError(storeClosedHint ?? "A loja está fechada no momento.");
            return;
        }
        if (sessionToken && !needsPhone) {
            goAfterIdentify();
            return;
        }
        setStep("identify");
    }

    async function identifyManual() {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(wmTokenFromUrl ? { wmToken: wmTokenFromUrl } : {}),
                    phone: customerPhone,
                    name: customerName || undefined,
                }),
            });
            const json = (await res.json()) as PublicMenuSessionOk | { ok: false; error: string };
            if (!json.ok) {
                if (json.error === "name_required") {
                    setIsNewCustomer(true);
                    setError("Informe seu nome para continuar.");
                } else if (json.error === "phone_invalid") {
                    setError("Telefone inválido. Use DDD + número.");
                } else {
                    setError("Não foi possível identificar. Tente de novo.");
                }
                return;
            }
            applySession(json);
            if (json.needsPhone || json.customer.needsPhone) {
                setError("Informe um telefone válido para continuar.");
                return;
            }
            goAfterIdentify();
        } catch {
            setError("Falha de conexão. Tente novamente.");
        } finally {
            setBusy(false);
        }
    }

    async function quoteDelivery(opts: {
        sessionToken: string;
        savedAddressId?: string | null;
        neighborhood?: string;
        cep?: string;
    }): Promise<{
        ok: boolean;
        served: boolean;
        fee: number | null;
        minOrder: number | null;
        message: string | null;
    }> {
        setDeliveryMsg(null);
        try {
            const res = await fetch(
                `/api/public/menu/${encodeURIComponent(slug)}/delivery-quote`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(opts),
                }
            );
            const json = (await res.json()) as {
                ok: boolean;
                served?: boolean;
                fee?: number;
                minOrder?: number | null;
                reason?: string | null;
                cepLookup?: {
                    logradouro: string;
                    bairro: string;
                    cidade: string;
                    estado: string;
                    cep: string;
                } | null;
            };
            if (!json.ok) {
                setDeliveryFee(null);
                setDeliveryMsg("Não foi possível calcular a entrega.");
                return {
                    ok: false,
                    served: false,
                    fee: null,
                    minOrder: null,
                    message: "quote_failed",
                };
            }
            const quoted =
                json.minOrder != null &&
                Number.isFinite(Number(json.minOrder)) &&
                Number(json.minOrder) > 0
                    ? Number(json.minOrder)
                    : null;
            if (quoted != null) setQuotedMinOrder(quoted);
            if (json.cepLookup) {
                setNewAddress((prev) => ({
                    ...prev,
                    logradouro: json.cepLookup!.logradouro || prev.logradouro,
                    bairro: json.cepLookup!.bairro || prev.bairro,
                    cidade: json.cepLookup!.cidade || prev.cidade,
                    estado: json.cepLookup!.estado || prev.estado,
                    cep: json.cepLookup!.cep || prev.cep,
                }));
            }
            if (!json.served) {
                const msg = json.reason || "Não entregamos neste bairro.";
                setDeliveryFee(null);
                setDeliveryMsg(msg);
                return { ok: true, served: false, fee: null, minOrder: quoted, message: msg };
            }
            const fee = Number(json.fee ?? 0);
            setDeliveryFee(fee);
            setDeliveryMsg(null);
            return { ok: true, served: true, fee, minOrder: quoted, message: null };
        } catch {
            setDeliveryFee(null);
            setDeliveryMsg("Falha ao calcular entrega.");
            return { ok: false, served: false, fee: null, minOrder: null, message: "network" };
        }
    }

    async function lookupCep() {
        if (!sessionToken || !newAddress.cep) return;
        setBusy(true);
        await quoteDelivery({
            sessionToken,
            cep: String(newAddress.cep),
            neighborhood: newAddress.bairro || undefined,
        });
        setBusy(false);
    }

    async function goPayment() {
        setError(null);
        if (!sessionToken) {
            setError("Identifique-se para continuar.");
            setStep("identify");
            return;
        }
        if (minHint.kind === "below") {
            return;
        }
        if (addressMode === "saved") {
            if (!savedAddressId) {
                setError("Selecione um endereço.");
                return;
            }
            setBusy(true);
            const q = await quoteDelivery({ sessionToken, savedAddressId });
            setBusy(false);
            if (!q.served) return;
            if (deliveryMinOrderHint(subtotal, q.minOrder ?? deliveryMinOrder).kind === "below") {
                return;
            }
            setFulfillmentType((prev) => prev ?? "delivery");
            setStep("payment");
            return;
        }
        const a = newAddress;
        if (
            !a.logradouro.trim() ||
            !a.numero.trim() ||
            !a.bairro.trim() ||
            !a.cidade.trim() ||
            a.estado.trim().length !== 2
        ) {
            setError("Preencha rua, número, bairro, cidade e UF.");
            return;
        }
        setBusy(true);
        const q = await quoteDelivery({
            sessionToken,
            neighborhood: a.bairro,
            cep: a.cep || undefined,
        });
        setBusy(false);
        if (!q.served) return;
        if (deliveryMinOrderHint(subtotal, q.minOrder ?? deliveryMinOrder).kind === "below") {
            return;
        }
        setFulfillmentType((prev) => prev ?? "delivery");
        setStep("payment");
    }

    async function placeOrder() {
        if (!sessionToken) return;
        setError(null);
        if (!fulfillmentType) {
            setError("Escolha entrega ou retirada no local.");
            setStep("fulfillment");
            return;
        }
        setBusy(true);
        const attemptKey = ensureCheckoutAttemptKey();
        try {
            const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionToken,
                    idempotencyKey: attemptKey,
                    items: cart.map((l) => ({ embalagemId: l.embalagemId, qty: l.qty })),
                    paymentMethod,
                    changeFor:
                        paymentMethod === "cash" && changeFor.trim()
                            ? Number(changeFor.replace(",", "."))
                            : null,
                    fulfillmentType,
                    savedAddressId:
                        fulfillmentType === "pickup"
                            ? null
                            : addressMode === "saved"
                              ? savedAddressId
                              : null,
                    newAddress:
                        fulfillmentType === "pickup"
                            ? null
                            : addressMode === "new"
                              ? newAddress
                              : null,
                }),
            });
            const json = (await res.json()) as PublicMenuCheckoutResult;
            if (!json.ok) {
                const map: Record<string, string> = {
                    delivery_not_served: "Não entregamos neste endereço.",
                    min_order_not_met: json.message ?? "Pedido abaixo do mínimo.",
                    address_incomplete: "Complete o endereço.",
                    empty_cart: "Carrinho vazio.",
                    session_invalid: "Sessão expirada. Identifique-se de novo.",
                    change_below_total: "Troco deve ser maior ou igual ao total.",
                    store_closed: json.message ?? "A loja está fechada no momento.",
                    fulfillment_required: "Escolha entrega ou retirada no local.",
                    delivery_disabled: "A loja não está aceitando entregas agora.",
                    pickup_disabled: "A loja não está aceitando retirada no momento.",
                    fulfillment_unavailable: "A loja não está aceitando pedidos no momento.",
                };
                setError(map[json.error] ?? json.message ?? "Não foi possível criar o pedido.");
                return;
            }
            checkoutAttemptKeyRef.current = null;
            setOrderResult(json);
            setStep("done");
            onClearCart();
        } catch {
            setError("Falha de conexão ao finalizar.");
        } finally {
            setBusy(false);
        }
    }

    const grand =
        fulfillmentType === "pickup"
            ? subtotal
            : subtotal + (deliveryFee != null && Number.isFinite(deliveryFee) ? deliveryFee : 0);

    const stepTitle =
        step === "cart"
            ? "Seu pedido"
            : step === "identify"
              ? "Seus dados"
              : step === "fulfillment"
                ? "Como receber"
                : step === "mode_notice"
                  ? soleNotice?.title ?? "Como receber"
                  : step === "address"
                    ? "Entrega"
                    : step === "payment"
                      ? "Pagamento"
                      : "Pronto";

    function MinOrderSoftCallout() {
        if (minHint.kind === "none") return null;
        const below = minHint.kind === "below";
        const tone = below
            ? "bg-amber-50 text-amber-950 ring-amber-200"
            : "bg-teal-50 text-teal-950 ring-teal-200";
        return (
            <div className={`space-y-3 rounded-xl px-3 py-3 text-sm ring-1 ${tone}`}>
                <div>
                    <p className="font-semibold">{minHint.title}</p>
                    <p className="mt-1 text-[13px] leading-snug opacity-90">{minHint.body}</p>
                </div>
                {below && pickupEnabled ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                            type="button"
                            onClick={onAddMore}
                            className="flex-1 rounded-lg bg-white/80 py-2.5 text-xs font-semibold ring-1 ring-amber-300"
                        >
                            Adicionar mais itens
                        </button>
                        <button
                            type="button"
                            onClick={choosePickup}
                            className="flex-1 rounded-lg bg-amber-900/90 py-2.5 text-xs font-semibold text-white"
                        >
                            Prefiro retirar
                        </button>
                    </div>
                ) : below ? (
                    <button
                        type="button"
                        onClick={onAddMore}
                        className="w-full rounded-lg bg-white/80 py-2.5 text-xs font-semibold ring-1 ring-amber-300"
                    >
                        Adicionar mais itens
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f6f3ee]">
            <header className="flex items-center justify-between border-b border-zinc-200 bg-[#1c1917] px-4 py-3 text-[#faf7f2]">
                <button
                    type="button"
                    onClick={onClose}
                    className="text-sm font-medium text-zinc-300"
                >
                    Voltar
                </button>
                <p className="text-sm font-semibold">
                    {stepTitle} · {storeName}
                </p>
                <span className="w-12" />
            </header>

            <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-5">
                {error ? (
                    <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                        {error}
                    </p>
                ) : null}

                {step === "cart" && (
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-900">Itens selecionados</h2>
                        {cart.length === 0 ? (
                            <p className="text-sm text-zinc-500">
                                Seu carrinho está vazio. Adicione itens no cardápio.
                            </p>
                        ) : (
                            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
                                {cart.map((l) => (
                                    <li key={l.embalagemId} className="flex items-center gap-3 p-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-zinc-900">
                                                {l.name}
                                            </p>
                                            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                                                {formatPackSiglaLabel(l.sigla, l.fatorConversao)} ·{" "}
                                                {formatBRL(l.unitPrice)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => onDec(l.embalagemId)}
                                                className="h-8 w-8 rounded-lg bg-zinc-100 text-sm font-bold"
                                                aria-label="Diminuir"
                                            >
                                                −
                                            </button>
                                            <span className="w-6 text-center text-sm font-semibold">
                                                {l.qty}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onInc(l.embalagemId)}
                                                className="h-8 w-8 rounded-lg bg-zinc-900 text-sm font-bold text-white"
                                                aria-label="Aumentar"
                                            >
                                                +
                                            </button>
                                        </div>
                                        <div className="w-16 text-right">
                                            <p className="text-sm font-bold">
                                                {formatBRL(l.unitPrice * l.qty)}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => onRemove(l.embalagemId)}
                                                className="text-[10px] font-medium text-red-600"
                                            >
                                                Excluir
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex justify-between text-sm font-semibold text-zinc-800">
                            <span>Subtotal</span>
                            <span>{formatBRL(subtotal)}</span>
                        </div>
                        {sessionToken ? (
                            <p className="text-xs text-emerald-700">
                                Identificado: {customerName || customerPhone}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            onClick={onAddMore}
                            className="w-full rounded-lg bg-white py-3 text-sm font-semibold ring-1 ring-zinc-300"
                        >
                            + Adicionar mais itens
                        </button>
                        {!storeIsOpen ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                {storeClosedHint ?? "Não estamos atendendo no momento."}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            disabled={busy || cart.length === 0 || !storeIsOpen}
                            onClick={continueFromCart}
                            className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            Continuar
                        </button>
                    </section>
                )}

                {step === "identify" && (
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-900">Seus dados</h2>
                        <p className="text-sm text-zinc-500">
                            Informe telefone com DDD. Se já for cliente, buscamos seus endereços.
                        </p>
                        <label className="block text-sm">
                            <span className="text-zinc-600">Telefone (WhatsApp)</span>
                            <input
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                inputMode="tel"
                                placeholder="(11) 99999-9999"
                            />
                        </label>
                        {(isNewCustomer || !sessionToken) && (
                            <label className="block text-sm">
                                <span className="text-zinc-600">Nome</span>
                                <input
                                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    placeholder="Seu nome"
                                />
                            </label>
                        )}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setStep("cart")}
                                className="flex-1 rounded-lg bg-white py-3 text-sm font-semibold ring-1 ring-zinc-200"
                            >
                                Voltar
                            </button>
                            <button
                                type="button"
                                disabled={busy || !customerPhone.trim()}
                                onClick={() => void identifyManual()}
                                className="flex-[2] rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            >
                                {busy ? "Carregando…" : "Continuar"}
                            </button>
                        </div>
                    </section>
                )}

                {step === "fulfillment" && (
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-900">Como prefere receber?</h2>
                        <MinOrderSoftCallout />
                        <button
                            type="button"
                            onClick={chooseDelivery}
                            className="w-full rounded-xl bg-white px-4 py-4 text-left ring-1 ring-zinc-200"
                        >
                            <p className="text-sm font-semibold text-zinc-900">Entrega</p>
                            <p className="text-xs text-zinc-500">
                                Receba no endereço que você informar
                                {deliveryCardMinLine ? ` · ${deliveryCardMinLine}` : ""}
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={choosePickup}
                            className="w-full rounded-xl bg-white px-4 py-4 text-left ring-1 ring-zinc-200"
                        >
                            <p className="text-sm font-semibold text-zinc-900">Retirar no local</p>
                            <p className="text-xs text-zinc-500">Sem taxa de entrega · sem pedido mínimo</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setStep(sessionToken ? "cart" : "identify")}
                            className="w-full rounded-lg bg-white py-3 text-sm font-semibold ring-1 ring-zinc-200"
                        >
                            Voltar
                        </button>
                    </section>
                )}

                {step === "mode_notice" && soleNotice && (
                    <section className="space-y-4">
                        <div className="rounded-xl bg-teal-50 px-4 py-4 text-teal-950 ring-1 ring-teal-200">
                            <h2 className="text-lg font-semibold">{soleNotice.title}</h2>
                            <p className="mt-2 text-sm leading-relaxed opacity-90">{soleNotice.body}</p>
                        </div>
                        {soleNotice.type === "delivery" ? <MinOrderSoftCallout /> : null}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setStep(sessionToken ? "cart" : "identify")}
                                className="flex-1 rounded-lg bg-white py-3 text-sm font-semibold ring-1 ring-zinc-200"
                            >
                                Voltar
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (soleNotice.type === "pickup") {
                                        setDeliveryFee(0);
                                        setDeliveryMsg(null);
                                        setStep("payment");
                                        return;
                                    }
                                    setStep("address");
                                }}
                                className="flex-[2] rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white"
                            >
                                {soleNotice.cta}
                            </button>
                        </div>
                    </section>
                )}

                {step === "address" && (
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-900">Entrega</h2>
                        <MinOrderSoftCallout />
                        {addresses.length > 0 && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAddressMode("saved")}
                                    className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                                        addressMode === "saved"
                                            ? "bg-zinc-900 text-white"
                                            : "bg-white ring-1 ring-zinc-200"
                                    }`}
                                >
                                    Endereço salvo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAddressMode("new");
                                        setSavedAddressId(null);
                                        setDeliveryFee(null);
                                    }}
                                    className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                                        addressMode === "new"
                                            ? "bg-zinc-900 text-white"
                                            : "bg-white ring-1 ring-zinc-200"
                                    }`}
                                >
                                    Novo endereço
                                </button>
                            </div>
                        )}

                        {addressMode === "saved" && addresses.length > 0 ? (
                            <ul className="space-y-2">
                                {addresses.map((a) => (
                                    <li key={a.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSavedAddressId(a.id);
                                                if (sessionToken) {
                                                    void quoteDelivery({
                                                        sessionToken,
                                                        savedAddressId: a.id,
                                                    });
                                                }
                                            }}
                                            className={`w-full rounded-xl px-3 py-3 text-left ring-1 ${
                                                savedAddressId === a.id
                                                    ? "bg-amber-50 ring-amber-400"
                                                    : "bg-white ring-zinc-200"
                                            }`}
                                        >
                                            <p className="text-sm font-semibold">{a.title}</p>
                                            <p className="text-xs text-zinc-500">{a.description}</p>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-zinc-200">
                                <div className="flex gap-2">
                                    <label className="block flex-1 text-sm">
                                        <span className="text-zinc-600">CEP</span>
                                        <input
                                            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                                            value={newAddress.cep ?? ""}
                                            onChange={(e) =>
                                                setNewAddress((p) => ({ ...p, cep: e.target.value }))
                                            }
                                            onBlur={() => void lookupCep()}
                                            inputMode="numeric"
                                        />
                                    </label>
                                    <label className="block w-24 text-sm">
                                        <span className="text-zinc-600">UF</span>
                                        <input
                                            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 uppercase"
                                            maxLength={2}
                                            value={newAddress.estado}
                                            onChange={(e) =>
                                                setNewAddress((p) => ({
                                                    ...p,
                                                    estado: e.target.value.toUpperCase(),
                                                }))
                                            }
                                        />
                                    </label>
                                </div>
                                {(
                                    [
                                        ["logradouro", "Rua"],
                                        ["numero", "Número"],
                                        ["complemento", "Complemento"],
                                        ["bairro", "Bairro"],
                                        ["cidade", "Cidade"],
                                        ["apelido", "Apelido (Casa, Trabalho…)"],
                                    ] as const
                                ).map(([fieldKey, label]) => (
                                    <label key={fieldKey} className="block text-sm">
                                        <span className="text-zinc-600">{label}</span>
                                        <input
                                            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                                            value={String(newAddress[fieldKey] ?? "")}
                                            onChange={(e) =>
                                                setNewAddress((p) => ({
                                                    ...p,
                                                    [fieldKey]: e.target.value,
                                                }))
                                            }
                                            onBlur={(ev) => {
                                                if (
                                                    fieldKey === "bairro" &&
                                                    sessionToken &&
                                                    ev.target.value.trim()
                                                ) {
                                                    void quoteDelivery({
                                                        sessionToken,
                                                        neighborhood: ev.target.value.trim(),
                                                    });
                                                }
                                            }}
                                        />
                                    </label>
                                ))}
                            </div>
                        )}

                        {deliveryMsg ? (
                            <p className="text-sm text-red-600">{deliveryMsg}</p>
                        ) : deliveryFee != null ? (
                            <p className="text-sm text-zinc-600">
                                Taxa de entrega: <strong>{formatBRL(deliveryFee)}</strong>
                            </p>
                        ) : null}

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (deliveriesEnabled && pickupEnabled) {
                                        setStep("fulfillment");
                                        return;
                                    }
                                    setStep("mode_notice");
                                }}
                                className="flex-1 rounded-lg bg-white py-3 text-sm font-semibold ring-1 ring-zinc-200"
                            >
                                Voltar
                            </button>
                            <button
                                type="button"
                                disabled={busy || Boolean(deliveryMsg) || minHint.kind === "below"}
                                onClick={() => void goPayment()}
                                className="flex-[2] rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            >
                                Continuar
                            </button>
                        </div>
                    </section>
                )}

                {step === "payment" && (
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-900">Pagamento</h2>
                        <ul className="divide-y divide-zinc-100 rounded-xl bg-white ring-1 ring-zinc-200">
                            {cart.map((l) => (
                                <li
                                    key={l.embalagemId}
                                    className="flex justify-between px-3 py-2 text-sm"
                                >
                                    <span>
                                        {l.qty}× {l.name}
                                    </span>
                                    <span className="font-medium">
                                        {formatBRL(l.unitPrice * l.qty)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="space-y-1 text-sm text-zinc-700">
                            <div className="flex justify-between">
                                <span>Subtotal</span>
                                <span>{formatBRL(subtotal)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>{fulfillmentType === "pickup" ? "Retirada" : "Entrega"}</span>
                                <span>
                                    {fulfillmentType === "pickup"
                                        ? formatBRL(0)
                                        : deliveryFee != null
                                          ? formatBRL(deliveryFee)
                                          : "—"}
                                </span>
                            </div>
                            <div className="flex justify-between text-base font-bold">
                                <span>Total</span>
                                <span>{formatBRL(grand)}</span>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            {(
                                [
                                    ["pix", "PIX"],
                                    ["cash", "Dinheiro"],
                                    ["card", "Cartão"],
                                ] as const
                            ).map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setPaymentMethod(id)}
                                    className={`flex-1 rounded-lg py-2.5 text-xs font-semibold ${
                                        paymentMethod === id
                                            ? "bg-zinc-900 text-white"
                                            : "bg-white ring-1 ring-zinc-200"
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {paymentMethod === "cash" && (
                            <label className="block text-sm">
                                <span className="text-zinc-600">Troco para</span>
                                <input
                                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                                    value={changeFor}
                                    onChange={(e) => setChangeFor(e.target.value)}
                                    inputMode="decimal"
                                    placeholder="Ex: 50"
                                />
                            </label>
                        )}

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (fulfillmentType === "pickup") {
                                        setStep(
                                            deliveriesEnabled && pickupEnabled
                                                ? "fulfillment"
                                                : "mode_notice"
                                        );
                                        return;
                                    }
                                    setStep("address");
                                }}
                                className="flex-1 rounded-lg bg-white py-3 text-sm font-semibold ring-1 ring-zinc-200"
                            >
                                Voltar
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void placeOrder()}
                                className="flex-[2] rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            >
                                {busy ? "Enviando…" : "Confirmar pedido"}
                            </button>
                        </div>
                    </section>
                )}

                {step === "done" && orderResult && (
                    <section className="space-y-4 text-center">
                        <p className="text-2xl">✅</p>
                        <h2 className="text-xl font-semibold text-zinc-900">
                            Pedido {orderResult.orderCode}
                        </h2>
                        <p className="text-sm text-zinc-600">
                            {orderResult.requireApproval
                                ? "Recebemos seu pedido e estamos confirmando. Aguarde retorno no WhatsApp!"
                                : "Pedido confirmado! Enviamos os detalhes no WhatsApp."}
                        </p>
                        <p className="text-sm text-zinc-500">{orderResult.deliveryAddress}</p>
                        <p className="text-lg font-bold">{formatBRL(orderResult.grandTotal)}</p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white"
                        >
                            Voltar ao cardápio
                        </button>
                    </section>
                )}
            </div>
        </div>
    );
}
