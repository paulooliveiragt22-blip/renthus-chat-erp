import { Boxes, MessageCircle, Printer, Store } from "lucide-react";
import { HOW_STEPS, PRODUCT_BLOCKS } from "@/lib/marketing/copy";

const ICONS = [MessageCircle, Store, Printer, Boxes] as const;

export function ProductLoop() {
    return (
        <div>
            <section aria-labelledby="como-funciona" className="bg-white">
                <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
                    <h2
                        id="como-funciona"
                        className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl"
                    >
                        Do pedido ao caixa, no mesmo fluxo
                    </h2>
                    <ol className="mt-8 grid gap-4 md:grid-cols-3">
                        {HOW_STEPS.map((step, index) => (
                            <li
                                key={step}
                                className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                            >
                                <span className="inline-flex size-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-extrabold text-white tabular-nums">
                                    {index + 1}
                                </span>
                                <p className="mt-3 text-sm leading-relaxed text-slate-600">{step}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section aria-labelledby="produto" className="bg-slate-50">
                <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
                    <h2
                        id="produto"
                        className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl"
                    >
                        O que a loja passa a ter
                    </h2>
                    <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {PRODUCT_BLOCKS.map((block, index) => {
                            const Icon = ICONS[index] ?? MessageCircle;
                            const wide = index === 0 || index === 3;
                            return (
                                <article
                                    key={block.title}
                                    className={`flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                                        wide ? "lg:col-span-2" : ""
                                    }`}
                                >
                                    <span className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 text-emerald-700">
                                        <Icon className="size-5" aria-hidden />
                                    </span>
                                    <h3 className="mt-4 font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight text-slate-950">
                                        {block.title}
                                    </h3>
                                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{block.body}</p>
                                    {index === 2 ? <PdvMini /> : null}
                                    {index === 3 ? <StockMini /> : null}
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section aria-labelledby="cardapio-web-fluxo" className="bg-white">
                <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
                    <h2 id="cardapio-web-fluxo" className="sr-only">
                        Como funciona o cardápio web
                    </h2>
                    <img
                        src="/brand/cardapio-web.png"
                        alt="O cliente pede no cardápio web, o pedido cai no painel e a comanda imprime."
                        width={1024}
                        height={1024}
                        className="h-auto w-full rounded-3xl border border-slate-200/80 shadow-xl"
                    />
                </div>
            </section>
        </div>
    );
}

function PdvMini() {
    return (
        <div className="mt-5 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
            <p className="text-[0.7rem] font-bold tracking-wide text-slate-500 uppercase">Pagamento misto</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <p className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-950 shadow-sm">
                    PIX <span className="block text-xs font-medium text-slate-500 tabular-nums">R$ 40,00</span>
                </p>
                <p className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-950 shadow-sm">
                    Dinheiro <span className="block text-xs font-medium text-slate-500 tabular-nums">R$ 20,00</span>
                </p>
            </div>
        </div>
    );
}

function StockMini() {
    return (
        <div className="mt-5 space-y-3">
            <StockBar label="Unidade" width="72%" />
            <StockBar label="Caixa" width="38%" />
        </div>
    );
}

function StockBar({ label, width }: { label: string; width: string }) {
    return (
        <div>
            <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
                <span>{label}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-600" style={{ width }} />
            </div>
        </div>
    );
}
