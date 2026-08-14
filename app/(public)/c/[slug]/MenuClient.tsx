"use client";

import { useEffect, useMemo, useState } from "react";
import type {
    PublicMenuCartLine,
    PublicMenuCategory,
    PublicMenuItem,
    PublicMenuResponse,
} from "@/src/types/contracts.public-menu";
import { saveStoredMenuSession } from "@/lib/public-menu/sessionStorage";
import {
    trackMenuEvent,
    trackMenuProductViewOnce,
} from "@/lib/public-menu/menuEvents";
import type { PublicMenuSessionOk } from "@/src/types/contracts.public-menu";
import { formatPackSiglaLabel } from "@/lib/products/packDisplayName";
import CheckoutDrawer from "./CheckoutDrawer";
import MyOrdersDrawer from "./MyOrdersDrawer";

function formatBRL(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
    if (!src) {
        return (
            <div
                aria-hidden
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-200 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:h-24 sm:w-24 md:h-[6.5rem] md:w-[6.5rem]"
            >
                sem foto
            </div>
        );
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={alt}
            className="h-20 w-20 shrink-0 rounded-xl object-cover bg-zinc-200 sm:h-24 sm:w-24 md:h-[6.5rem] md:w-[6.5rem]"
            loading="lazy"
        />
    );
}

function cartKey(slug: string): string {
    return `renthus_menu_cart_${slug}`;
}

function loadCart(slug: string): PublicMenuCartLine[] {
    try {
        const raw = globalThis.localStorage?.getItem(cartKey(slug));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as PublicMenuCartLine[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export default function MenuClient({ menu }: { menu: PublicMenuResponse }) {
    const [activeCat, setActiveCat] = useState<string | "all">("all");
    const [cart, setCart] = useState<PublicMenuCartLine[]>([]);
    const [cartReady, setCartReady] = useState(false);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [ordersOpen, setOrdersOpen] = useState(false);
    const store = menu.store;

    useEffect(() => {
        const params = new URLSearchParams(globalThis.location.search);
        if (params.get("orders") === "1") setOrdersOpen(true);
        const wantCheckout = params.get("checkout") === "1";
        const hc = params.get("hc")?.trim() ?? "";

        if (!hc) {
            setCart(loadCart(store.slug));
            if (wantCheckout) setCheckoutOpen(true);
            setCartReady(true);
            return;
        }

        void fetch(
            `/api/public/menu/${encodeURIComponent(store.slug)}/handoff?hc=${encodeURIComponent(hc)}`
        )
            .then(async (res) => {
                const json = (await res.json()) as {
                    ok?: boolean;
                    purpose?: string;
                    cart?: PublicMenuCartLine[];
                };
                if (json.ok && Array.isArray(json.cart) && json.cart.length > 0) {
                    setCart(json.cart);
                    if (json.purpose === "checkout" || wantCheckout) setCheckoutOpen(true);
                } else {
                    setCart(loadCart(store.slug));
                    if (wantCheckout) setCheckoutOpen(true);
                }
            })
            .catch(() => {
                setCart(loadCart(store.slug));
                if (wantCheckout) setCheckoutOpen(true);
            })
            .finally(() => setCartReady(true));
    }, [store.slug]);

    useEffect(() => {
        if (!cartReady) return;
        try {
            globalThis.localStorage?.setItem(cartKey(store.slug), JSON.stringify(cart));
        } catch {
            /* ignore */
        }
    }, [cart, cartReady, store.slug]);

    const categories = menu.categories;
    const visible: PublicMenuCategory[] = useMemo(() => {
        if (activeCat === "all") return categories;
        return categories.filter((c) => c.id === activeCat);
    }, [activeCat, categories]);

    useEffect(() => {
        trackMenuEvent({ slug: store.slug, eventType: "page_view" });

        const params = new URLSearchParams(globalThis.location.search);
        const wm = params.get("wm");
        if (!wm) return;
        void fetch(`/api/public/menu/${encodeURIComponent(store.slug)}/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wmToken: wm }),
        })
            .then(async (res) => {
                const json = (await res.json()) as PublicMenuSessionOk | { ok: false };
                if (!json.ok) return;
                if (json.needsPhone || json.customer.needsPhone || !json.customer.phoneE164) {
                    return;
                }
                saveStoredMenuSession(store.slug, {
                    sessionToken: json.sessionToken,
                    customerName: json.customer.name,
                    phoneE164: json.customer.phoneE164,
                });
            })
            .catch(() => {});
    }, [store.slug]);

    const cartQty = cart.reduce((s, l) => s + l.qty, 0);
    const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);

    function qtyOf(embalagemId: string): number {
        return cart.find((l) => l.embalagemId === embalagemId)?.qty ?? 0;
    }

    function addItem(item: PublicMenuItem) {
        trackMenuProductViewOnce({
            slug: store.slug,
            productId: item.productId,
            categoryId: item.categoryId,
            embalagemId: item.embalagemId,
        });
        // Cardápio web: itens ativos com preço já vêm da API; estoque_atual zerado
        // é comum (cadastro sem controle) e não deve bloquear o pedido.
        setCart((prev) => {
            const i = prev.findIndex((l) => l.embalagemId === item.embalagemId);
            if (i >= 0) {
                const next = [...prev];
                const cur = next[i]!;
                next[i] = { ...cur, qty: Math.min(99, cur.qty + 1), unitPrice: item.price };
                return next;
            }
            return [
                ...prev,
                {
                    embalagemId: item.embalagemId,
                    productId: item.productId,
                    name: item.name,
                    sigla: item.sigla,
                    fatorConversao: item.fatorConversao,
                    unitPrice: item.price,
                    qty: 1,
                },
            ];
        });
    }

    function decItem(embalagemId: string) {
        setCart((prev) => {
            const i = prev.findIndex((l) => l.embalagemId === embalagemId);
            if (i < 0) return prev;
            const cur = prev[i]!;
            if (cur.qty <= 1) return prev.filter((l) => l.embalagemId !== embalagemId);
            const next = [...prev];
            next[i] = { ...cur, qty: cur.qty - 1 };
            return next;
        });
    }

    function incCartLine(embalagemId: string) {
        setCart((prev) => {
            const i = prev.findIndex((l) => l.embalagemId === embalagemId);
            if (i < 0) return prev;
            const next = [...prev];
            const cur = next[i]!;
            next[i] = { ...cur, qty: Math.min(99, cur.qty + 1) };
            return next;
        });
    }

    function removeCartLine(embalagemId: string) {
        setCart((prev) => prev.filter((l) => l.embalagemId !== embalagemId));
    }

    const shell = "mx-auto w-full max-w-xl px-3 sm:max-w-2xl sm:px-5 md:max-w-3xl lg:max-w-4xl";

    return (
        <div className="min-h-dvh bg-[#f0f2f5] text-zinc-900 pb-28">
            <header className="bg-white shadow-sm">
                <div className="relative">
                    <div className="relative h-40 overflow-hidden bg-gradient-to-br from-zinc-400 to-zinc-600 sm:h-52 md:h-64 lg:h-72">
                        {store.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={store.coverUrl}
                                alt=""
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div
                                aria-hidden
                                className="h-full w-full bg-[linear-gradient(135deg,#78716c_0%,#44403c_55%,#292524_100%)]"
                            />
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent" />
                    </div>

                    <div className={`${shell} relative pb-4 pt-0`}>
                        <div className="-mt-12 flex flex-col gap-3 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between sm:gap-4 md:-mt-16">
                            <div className="flex min-w-0 items-end gap-3 sm:gap-4">
                                {store.logoUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={store.logoUrl}
                                        alt=""
                                        className="h-24 w-24 shrink-0 rounded-full object-cover ring-4 ring-white shadow-md sm:h-28 sm:w-28 md:h-32 md:w-32"
                                    />
                                ) : (
                                    <div
                                        aria-hidden
                                        className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-2xl font-bold text-zinc-600 ring-4 ring-white shadow-md sm:h-28 sm:w-28 sm:text-3xl md:h-32 md:w-32"
                                    >
                                        {store.displayName.trim().charAt(0).toUpperCase() || "?"}
                                    </div>
                                )}
                                <div className="min-w-0 pb-1 sm:pb-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 sm:text-[11px]">
                                        Cardápio
                                    </p>
                                    <h1 className="mt-0.5 truncate text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl md:text-3xl">
                                        {store.displayName}
                                    </h1>
                                    {store.tagline ? (
                                        <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 sm:text-[15px]">
                                            {store.tagline}
                                        </p>
                                    ) : null}
                                    {(store.city || store.state) && (
                                        <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
                                            {[store.city, store.state].filter(Boolean).join(" · ")}
                                        </p>
                                    )}
                                    <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
                                        {store.isOpen ? (
                                            <span className="font-medium text-emerald-700">Aberto</span>
                                        ) : (
                                            <span className="font-medium text-amber-700">Fechado</span>
                                        )}
                                        {store.openTime && store.closeTime
                                            ? ` · ${store.openTime}–${store.closeTime}`
                                            : null}
                                    </p>
                                    {store.deliveryDescription ? (
                                        <p className="mt-1 line-clamp-2 text-xs text-zinc-600 sm:text-sm">
                                            {store.deliveryDescription}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOrdersOpen(true)}
                                className="shrink-0 self-start rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200 transition hover:bg-zinc-200 sm:self-auto sm:text-sm"
                            >
                                Meus pedidos
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {categories.length > 1 && (
                <nav className="sticky top-0 z-10 border-b border-zinc-200/80 bg-[#f0f2f5]/95 backdrop-blur">
                    <div className={`${shell} flex gap-2 overflow-x-auto py-3`}>
                        <button
                            type="button"
                            onClick={() => setActiveCat("all")}
                            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold sm:text-sm ${
                                activeCat === "all"
                                    ? "bg-zinc-900 text-white"
                                    : "bg-white text-zinc-600 ring-1 ring-zinc-200"
                            }`}
                        >
                            Todos
                        </button>
                        {categories.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                    setActiveCat(c.id);
                                    trackMenuEvent({
                                        slug: store.slug,
                                        eventType: "category_view",
                                        categoryId: c.id,
                                    });
                                }}
                                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold sm:text-sm ${
                                    activeCat === c.id
                                        ? "bg-zinc-900 text-white"
                                        : "bg-white text-zinc-600 ring-1 ring-zinc-200"
                                }`}
                            >
                                {c.name}
                            </button>
                        ))}
                    </div>
                </nav>
            )}

            <main className={`${shell} py-5 sm:py-7`}>
                {menu.itemCount === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-500 sm:text-base">
                        Nenhum item disponível no cardápio no momento.
                    </p>
                ) : (
                    <div className="flex flex-col gap-7 sm:gap-9">
                        {visible.map((cat) => (
                            <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                                <h2
                                    id={`cat-${cat.id}`}
                                    className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 sm:text-sm"
                                >
                                    {cat.name}
                                </h2>
                                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200/80">
                                    {cat.items.map((item) => {
                                        const q = qtyOf(item.embalagemId);
                                        return (
                                            <li
                                                key={item.embalagemId}
                                                className="flex gap-3 p-3.5 sm:gap-4 sm:p-4"
                                            >
                                                <ProductThumb
                                                    src={item.thumbnailUrl ?? item.imageUrl}
                                                    alt={item.name}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <p className="text-[15px] font-semibold leading-snug text-zinc-900 sm:text-base">
                                                            {item.name}
                                                        </p>
                                                        <p className="shrink-0 text-[15px] font-bold text-zinc-900 sm:text-base">
                                                            {formatBRL(item.price)}
                                                        </p>
                                                    </div>
                                                    {item.description ? (
                                                        <p className="mt-1 line-clamp-2 text-xs text-zinc-500 sm:text-sm">
                                                            {item.description}
                                                        </p>
                                                    ) : null}
                                                    <div className="mt-2.5 flex items-center justify-between gap-2">
                                                        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 sm:text-[11px]">
                                                            {formatPackSiglaLabel(
                                                                item.sigla,
                                                                item.fatorConversao
                                                            )}
                                                        </p>
                                                        {q === 0 ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => addItem(item)}
                                                                className="rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white sm:text-sm"
                                                            >
                                                                Adicionar
                                                            </button>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        decItem(item.embalagemId)
                                                                    }
                                                                    className="h-9 w-9 rounded-lg bg-zinc-100 text-base font-bold"
                                                                    aria-label="Diminuir"
                                                                >
                                                                    −
                                                                </button>
                                                                <span className="w-6 text-center text-sm font-semibold sm:text-base">
                                                                    {q}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => addItem(item)}
                                                                    className="h-9 w-9 rounded-lg bg-zinc-900 text-base font-bold text-white"
                                                                    aria-label="Aumentar"
                                                                >
                                                                    +
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </main>

            {cartQty > 0 && !checkoutOpen && !ordersOpen && (
                <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur sm:p-4">
                    <div className={shell}>
                        <button
                            type="button"
                            onClick={() => setCheckoutOpen(true)}
                            className="flex w-full items-center justify-between rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg sm:py-4 sm:text-base"
                        >
                            <span>
                                Ver pedido · {cartQty} {cartQty === 1 ? "item" : "itens"}
                            </span>
                            <span>{formatBRL(cartTotal)}</span>
                        </button>
                    </div>
                </div>
            )}

            {checkoutOpen && (
                <CheckoutDrawer
                    slug={store.slug}
                    storeName={store.displayName}
                    deliveriesEnabled={store.deliveriesEnabled}
                    pickupEnabled={store.pickupEnabled}
                    storeIsOpen={store.isOpen}
                    storeClosedHint={
                        store.openTime && store.closeTime
                            ? `No momento estamos fechados. Horário: ${store.openTime}–${store.closeTime}.`
                            : "No momento estamos fechados."
                    }
                    cart={cart}
                    onClose={() => setCheckoutOpen(false)}
                    onClearCart={() => setCart([])}
                    onInc={incCartLine}
                    onDec={decItem}
                    onRemove={removeCartLine}
                    onAddMore={() => setCheckoutOpen(false)}
                />
            )}

            {ordersOpen && (
                <MyOrdersDrawer
                    slug={store.slug}
                    storeName={store.displayName}
                    onClose={() => setOrdersOpen(false)}
                />
            )}

            <footer className={`${shell} pb-10 pt-2 text-center text-[11px] text-zinc-400 sm:text-xs`}>
                Powered by Lysthub
            </footer>
        </div>
    );
}
