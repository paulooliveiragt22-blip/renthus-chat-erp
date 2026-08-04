"use client";

import { useEffect, useMemo, useState } from "react";
import type {
    PublicMenuCartLine,
    PublicMenuCategory,
    PublicMenuItem,
    PublicMenuResponse,
} from "@/src/types/contracts.public-menu";
import { getOrCreateMenuVisitorId } from "@/lib/public-menu/visitorId";
import { saveStoredMenuSession } from "@/lib/public-menu/sessionStorage";
import type { PublicMenuSessionOk } from "@/src/types/contracts.public-menu";
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
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
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
            className="h-16 w-16 shrink-0 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800"
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
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [ordersOpen, setOrdersOpen] = useState(false);
    const store = menu.store;

    useEffect(() => {
        setCart(loadCart(store.slug));
    }, [store.slug]);

    useEffect(() => {
        try {
            globalThis.localStorage?.setItem(cartKey(store.slug), JSON.stringify(cart));
        } catch {
            /* ignore */
        }
    }, [cart, store.slug]);

    const categories = menu.categories;
    const visible: PublicMenuCategory[] = useMemo(() => {
        if (activeCat === "all") return categories;
        return categories.filter((c) => c.id === activeCat);
    }, [activeCat, categories]);

    useEffect(() => {
        const visitorId = getOrCreateMenuVisitorId();
        const params = new URLSearchParams(globalThis.location.search);
        void fetch(`/api/public/menu/${encodeURIComponent(store.slug)}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                visitorId,
                eventType: "page_view",
                utmSource: params.get("utm_source"),
                utmMedium: params.get("utm_medium"),
                utmCampaign: params.get("utm_campaign"),
                referrer: typeof document === "undefined" ? null : document.referrer || null,
            }),
        }).catch(() => {});

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

    return (
        <div className="min-h-dvh bg-[#f6f3ee] text-zinc-900 pb-24">
            <header className="border-b border-zinc-200/80 bg-[#1c1917] text-[#faf7f2]">
                <div className="mx-auto flex max-w-lg flex-col gap-3 px-4 pb-5 pt-8">
                    {store.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={store.logoUrl}
                            alt=""
                            className="h-14 w-14 rounded-full object-cover ring-2 ring-white/20"
                        />
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">
                                Cardápio
                            </p>
                            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                                {store.displayName}
                            </h1>
                            {store.tagline ? (
                                <p className="mt-1 text-sm text-zinc-300">{store.tagline}</p>
                            ) : null}
                            {(store.city || store.state) && (
                                <p className="mt-2 text-xs text-zinc-400">
                                    {[store.city, store.state].filter(Boolean).join(" · ")}
                                </p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setOrdersOpen(true)}
                            className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-amber-100 ring-1 ring-white/20 transition hover:bg-white/15"
                        >
                            Meus pedidos
                        </button>
                    </div>
                </div>
            </header>

            {categories.length > 1 && (
                <nav className="sticky top-0 z-10 border-b border-zinc-200 bg-[#f6f3ee]/90 backdrop-blur">
                    <div className="mx-auto flex max-w-lg gap-2 overflow-x-auto px-4 py-3">
                        <button
                            type="button"
                            onClick={() => setActiveCat("all")}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
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
                                onClick={() => setActiveCat(c.id)}
                                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
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

            <main className="mx-auto max-w-lg px-4 py-6">
                {menu.itemCount === 0 ? (
                    <p className="py-16 text-center text-sm text-zinc-500">
                        Nenhum item disponível no cardápio no momento.
                    </p>
                ) : (
                    <div className="flex flex-col gap-8">
                        {visible.map((cat) => (
                            <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                                <h2
                                    id={`cat-${cat.id}`}
                                    className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-500"
                                >
                                    {cat.name}
                                </h2>
                                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
                                    {cat.items.map((item) => {
                                        const q = qtyOf(item.embalagemId);
                                        return (
                                            <li key={item.embalagemId} className="flex gap-3 p-3">
                                                <ProductThumb
                                                    src={item.thumbnailUrl ?? item.imageUrl}
                                                    alt={item.name}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <p className="text-sm font-semibold leading-snug text-zinc-900">
                                                            {item.name}
                                                        </p>
                                                        <p className="shrink-0 text-sm font-bold text-zinc-900">
                                                            {formatBRL(item.price)}
                                                        </p>
                                                    </div>
                                                    {item.description ? (
                                                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                                                            {item.description}
                                                        </p>
                                                    ) : null}
                                                    <div className="mt-2 flex items-center justify-between gap-2">
                                                        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                                                            {item.sigla}
                                                        </p>
                                                        {q === 0 ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => addItem(item)}
                                                                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white"
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
                                                                    className="h-8 w-8 rounded-lg bg-zinc-100 text-sm font-bold"
                                                                    aria-label="Diminuir"
                                                                >
                                                                    −
                                                                </button>
                                                                <span className="w-5 text-center text-sm font-semibold">
                                                                    {q}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => addItem(item)}
                                                                    className="h-8 w-8 rounded-lg bg-zinc-900 text-sm font-bold text-white"
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
                <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur">
                    <div className="mx-auto max-w-lg">
                        <button
                            type="button"
                            onClick={() => setCheckoutOpen(true)}
                            className="flex w-full items-center justify-between rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg"
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

            <footer className="mx-auto max-w-lg px-4 pb-10 pt-2 text-center text-[11px] text-zinc-400">
                Powered by Renthus
            </footer>
        </div>
    );
}
