"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, MapPin, Search, X } from "lucide-react";
import type {
    PublicMenuCartLine,
    PublicMenuCategory,
    PublicMenuItem,
    PublicMenuResponse,
    PublicMenuSavedAddress,
    PublicMenuSessionOk,
} from "@/src/types/contracts.public-menu";
import {
    trackMenuEvent,
    trackMenuProductViewOnce,
} from "@/lib/public-menu/menuEvents";
import { getMenuSession, postMenuSession } from "@/lib/public-menu/clientMenuSession";
import { formatMenuCustomerAddressLine } from "@/lib/public-menu/formatMenuAddress";
import { formatPackSiglaLabel } from "@/lib/products/packDisplayName";
import { filterPublicMenuCategories } from "@/lib/public-menu/searchMenuItems";
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

function addrPickKey(slug: string): string {
    return `renthus_menu_addr_${slug}`;
}

function loadPickedAddressId(slug: string): string | null {
    try {
        return globalThis.sessionStorage?.getItem(addrPickKey(slug)) || null;
    } catch {
        return null;
    }
}

function savePickedAddressId(slug: string, id: string): void {
    try {
        globalThis.sessionStorage?.setItem(addrPickKey(slug), id);
    } catch {
        /* ignore */
    }
}

function pickDefaultAddressId(
    list: PublicMenuSavedAddress[],
    slug: string
): string | null {
    if (list.length === 0) return null;
    const stored = loadPickedAddressId(slug);
    if (stored && list.some((a) => a.id === stored)) return stored;
    return (list.find((a) => a.isPrincipal) ?? list[0]!).id;
}

function applySessionAddresses(
    json: PublicMenuSessionOk,
    slug: string
): { addresses: PublicMenuSavedAddress[]; selectedId: string | null } {
    const phonePending = Boolean(json.needsPhone || json.customer.needsPhone);
    if (phonePending) return { addresses: [], selectedId: null };
    const addresses = json.addresses ?? [];
    return { addresses, selectedId: pickDefaultAddressId(addresses, slug) };
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
    const [searchQuery, setSearchQuery] = useState("");
    const [cart, setCart] = useState<PublicMenuCartLine[]>([]);
    const [cartReady, setCartReady] = useState(false);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [ordersOpen, setOrdersOpen] = useState(false);
    const [addresses, setAddresses] = useState<PublicMenuSavedAddress[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
    const [addressPickerOpen, setAddressPickerOpen] = useState(false);
    const store = menu.store;

    useEffect(() => {
        const params = new URLSearchParams(globalThis.location.search);
        const wm = params.get("wm")?.trim() ?? "";
        const wantOrders = params.get("orders") === "1";
        const wantCheckout = params.get("checkout") === "1";
        const hc = params.get("hc")?.trim() ?? "";

        void (async () => {
            // Identidade antes de abrir Meus pedidos — senão o drawer mostra fallback
            // com cookie ainda vazio (WebView do WhatsApp).
            let session: PublicMenuSessionOk | { ok: false; error: string } | null = null;
            if (wm) {
                session = await postMenuSession(store.slug, { wmToken: wm }).catch(() => null);
            }
            if (!session || !session.ok) {
                session = await getMenuSession(store.slug).catch(() => null);
            }
            if (session?.ok) {
                const applied = applySessionAddresses(session, store.slug);
                setAddresses(applied.addresses);
                setSelectedAddressId(applied.selectedId);
            }
            if (wantOrders) setOrdersOpen(true);

            if (!hc) {
                setCart(loadCart(store.slug));
                if (wantCheckout) setCheckoutOpen(true);
                setCartReady(true);
                return;
            }

            try {
                const res = await fetch(
                    `/api/public/menu/${encodeURIComponent(store.slug)}/handoff?hc=${encodeURIComponent(hc)}`
                );
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
            } catch {
                setCart(loadCart(store.slug));
                if (wantCheckout) setCheckoutOpen(true);
            } finally {
                setCartReady(true);
            }
        })();
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
    const searched: PublicMenuCategory[] = useMemo(
        () => filterPublicMenuCategories(categories, searchQuery),
        [categories, searchQuery]
    );
    const visible: PublicMenuCategory[] = useMemo(() => {
        if (activeCat === "all") return searched;
        return searched.filter((c) => c.id === activeCat);
    }, [activeCat, searched]);
    const searchActive = searchQuery.trim().length >= 2;

    useEffect(() => {
        trackMenuEvent({ slug: store.slug, eventType: "page_view" });
    }, [store.slug]);

    const cartQty = cart.reduce((s, l) => s + l.qty, 0);
    const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const selectedAddress =
        addresses.find((a) => a.id === selectedAddressId) ??
        addresses.find((a) => a.isPrincipal) ??
        addresses[0] ??
        null;

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
                <div className="h-40 overflow-hidden bg-gradient-to-br from-zinc-400 to-zinc-600 sm:h-52 md:h-64 lg:h-72">
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
                </div>

                <div className={`${shell} relative z-10 pb-4 pt-3 sm:pt-4`}>
                    <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                        <div className="flex w-20 shrink-0 flex-col items-center sm:w-24 md:w-28">
                            {store.logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={store.logoUrl}
                                    alt=""
                                    className="relative z-10 -mt-10 h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-white shadow-md sm:-mt-12 sm:h-24 sm:w-24 md:-mt-14 md:h-28 md:w-28"
                                />
                            ) : (
                                <div
                                    aria-hidden
                                    className="relative z-10 -mt-10 flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xl font-bold text-zinc-600 ring-4 ring-white shadow-md sm:-mt-12 sm:h-24 sm:w-24 sm:text-2xl md:-mt-14 md:h-28 md:w-28"
                                >
                                    {store.displayName.trim().charAt(0).toUpperCase() || "?"}
                                </div>
                            )}
                            <p className="mt-2 w-full text-center text-xs leading-snug text-zinc-600 sm:text-sm">
                                {store.isOpen ? (
                                    <span className="font-semibold text-emerald-700">Aberto</span>
                                ) : (
                                    <span className="font-semibold text-amber-700">Fechado</span>
                                )}
                                {store.hoursLabel ? (
                                    <span className="mt-0.5 block text-[11px] text-zinc-500 sm:text-xs">
                                        {store.hoursLabel}
                                    </span>
                                ) : null}
                            </p>
                        </div>
                        <div className="min-w-0 flex-1 pb-0.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 sm:text-[11px]">
                                Cardápio
                            </p>
                            <h1 className="mt-0.5 break-words text-xl font-bold leading-snug text-zinc-900 sm:text-2xl md:text-3xl">
                                {store.displayName}
                            </h1>
                            {store.tagline ? (
                                <p className="mt-0.5 break-words text-sm leading-snug text-zinc-600 sm:text-[15px]">
                                    {store.tagline}
                                </p>
                            ) : null}
                            {!store.isOpen && store.closedMessage ? (
                                <p className="mt-1 text-xs text-amber-800 sm:text-sm">
                                    {store.closedMessage}
                                </p>
                            ) : null}
                            {selectedAddress ? (
                                <div className="mt-2 min-w-0 w-full">
                                    <div className="flex w-full min-w-0 items-start gap-2 text-sm text-zinc-700">
                                        <MapPin
                                            aria-hidden
                                            className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
                                        />
                                        <div className="min-w-0 flex-1 basis-0">
                                            <p className="whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">
                                                {formatMenuCustomerAddressLine(selectedAddress)}
                                            </p>
                                            {addresses.length > 1 ? (
                                                <button
                                                    type="button"
                                                    aria-expanded={addressPickerOpen}
                                                    onClick={() =>
                                                        setAddressPickerOpen((v) => !v)
                                                    }
                                                    className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                                                >
                                                    Alterar endereço
                                                    <ChevronDown
                                                        className={`h-3.5 w-3.5 transition ${
                                                            addressPickerOpen ? "rotate-180" : ""
                                                        }`}
                                                    />
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {addressPickerOpen && addresses.length > 1 ? (
                                        <ul className="mt-2 space-y-1.5">
                                            {addresses.map((a) => (
                                                <li key={a.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedAddressId(a.id);
                                                            savePickedAddressId(
                                                                store.slug,
                                                                a.id
                                                            );
                                                            setAddressPickerOpen(false);
                                                        }}
                                                        className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ring-1 ${
                                                            a.id === selectedAddressId
                                                                ? "bg-amber-50 ring-amber-400"
                                                                : "bg-white ring-zinc-200"
                                                        }`}
                                                    >
                                                        <p className="font-semibold text-zinc-900">
                                                            {a.title}
                                                            {a.isPrincipal ? (
                                                                <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                                                                    principal
                                                                </span>
                                                            ) : null}
                                                        </p>
                                                        <p className="mt-0.5 break-words text-xs leading-snug text-zinc-500">
                                                            {formatMenuCustomerAddressLine(a)}
                                                        </p>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            ) : null}
                            {store.deliveryDescription ? (
                                <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500 sm:text-sm">
                                    {store.deliveryDescription}
                                </p>
                            ) : null}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setOrdersOpen(true)}
                        className="mt-3 w-full rounded-lg bg-zinc-100 px-3.5 py-2.5 text-sm font-semibold text-zinc-800 ring-1 ring-zinc-200 transition hover:bg-zinc-200"
                    >
                        Meus pedidos
                    </button>
                </div>
            </header>

            {menu.itemCount > 0 && (
                <div className="sticky top-0 z-10 border-b border-zinc-200/80 bg-[#f0f2f5]/95 backdrop-blur">
                    <div className={`${shell} py-3`}>
                        <label className="relative block">
                            <Search
                                aria-hidden
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                            />
                            <input
                                type="text"
                                inputMode="search"
                                enterKeyHint="search"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Buscar produto…"
                                aria-label="Buscar no cardápio"
                                className="w-full rounded-xl bg-white py-2.5 pl-10 pr-10 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 sm:text-[15px]"
                            />
                            {searchQuery ? (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery("")}
                                    aria-label="Limpar busca"
                                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            ) : null}
                        </label>
                        {categories.length > 1 && (
                            <nav className="mt-3 flex gap-2 overflow-x-auto" aria-label="Categorias">
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
                            </nav>
                        )}
                    </div>
                </div>
            )}

            <main className={`${shell} py-5 sm:py-7`}>
                {menu.itemCount === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-500 sm:text-base">
                        Nenhum item disponível no cardápio no momento.
                    </p>
                ) : visible.length === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-500 sm:text-base">
                        {searchActive
                            ? `Nenhum item encontrado para “${searchQuery.trim()}”.`
                            : "Nenhum item nesta categoria."}
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
                    whatsappPhone={store.whatsappPhone}
                    deliveriesEnabled={store.deliveriesEnabled}
                    pickupEnabled={store.pickupEnabled}
                    deliveryMinOrder={store.deliveryMinOrder}
                    acceptedPayments={store.acceptedPayments ?? ["pix", "cash", "card"]}
                    storeIsOpen={store.isOpen}
                    storeClosedHint={
                        store.closedMessage || "Não estamos atendendo no momento."
                    }
                    cart={cart}
                    preferredSavedAddressId={selectedAddressId}
                    onPreferredAddressChange={(id) => {
                        setSelectedAddressId(id);
                        savePickedAddressId(store.slug, id);
                    }}
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
                    whatsappPhone={store.whatsappPhone}
                    onClose={() => setOrdersOpen(false)}
                />
            )}

            <footer className={`${shell} pb-10 pt-2 text-center text-[11px] text-zinc-400 sm:text-xs`}>
                Powered by Lysthub
            </footer>
        </div>
    );
}
