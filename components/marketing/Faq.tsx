import { FAQ_ITEMS } from "@/lib/marketing/copy";

type FaqItem = { q: string; a: string };

type FaqProps = {
    items?: readonly FaqItem[];
};

export function Faq({ items = FAQ_ITEMS }: FaqProps) {
    return (
        <section aria-labelledby="faq" className="bg-white">
            <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-24">
                <h2
                    id="faq"
                    className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl"
                >
                    Dúvidas rápidas
                </h2>
                <div className="mt-5 divide-y divide-slate-200/80 rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                    {items.map((item) => (
                        <details key={item.q} className="group px-4 py-3.5 sm:px-5">
                            <summary className="cursor-pointer list-none text-sm font-bold text-slate-950 sm:text-base [&::-webkit-details-marker]:hidden">
                                <span className="flex items-center justify-between gap-4">
                                    {item.q}
                                    <span aria-hidden className="text-emerald-600 transition-transform duration-200 group-open:rotate-45">
                                        +
                                    </span>
                                </span>
                            </summary>
                            <p className="mt-2 text-sm leading-snug text-slate-600">{item.a}</p>
                        </details>
                    ))}
                </div>
            </div>
        </section>
    );
}
