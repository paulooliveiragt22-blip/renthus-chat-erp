"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicMenuCategory, PublicMenuResponse } from "@/src/types/contracts.public-menu";
import { getOrCreateMenuVisitorId } from "@/lib/public-menu/visitorId";

function formatBRL(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function toWaMe(phone: string | null, text: string): string | null {
    if (!phone) return null;
    const digits = phone.replaceAll(/\D/g, "");
    if (digits.length < 10) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
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

export default function MenuClient({ menu }: { menu: PublicMenuResponse }) {
    const [activeCat, setActiveCat] = useState<string | "all">("all");
    const store = menu.store;

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
    }, [store.slug]);

    const waHref = toWaMe(
        store.whatsappPhone,
        `Olá! Vi o cardápio de *${store.displayName}* e quero fazer um pedido.`
    );

    return (
        <div className="min-h-dvh bg-[#f6f3ee] text-zinc-900">
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
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">
                            Cardápio
                        </p>
                        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{store.displayName}</h1>
                        {store.tagline ? (
                            <p className="mt-1 text-sm text-zinc-300">{store.tagline}</p>
                        ) : null}
                        {(store.city || store.state) && (
                            <p className="mt-2 text-xs text-zinc-400">
                                {[store.city, store.state].filter(Boolean).join(" · ")}
                            </p>
                        )}
                    </div>
                    {waHref && (
                        <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-fit items-center justify-center rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
                        >
                            Pedir no WhatsApp
                        </a>
                    )}
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
                                    {cat.items.map((item) => (
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
                                                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                                                    {item.sigla}
                                                    {!item.inStock ? " · indisponível" : ""}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </main>

            <footer className="mx-auto max-w-lg px-4 pb-10 pt-2 text-center text-[11px] text-zinc-400">
                Powered by Renthus
            </footer>
        </div>
    );
}
