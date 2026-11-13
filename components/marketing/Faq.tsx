import { FAQ_ITEMS } from "@/lib/marketing/copy";

export function Faq() {
    return (
        <section aria-labelledby="faq" className="bg-white">
            <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-24">
                <h2
                    id="faq"
                    className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl"
                >
                    Perguntas frequentes
                </h2>
                <div className="mt-6 divide-y divide-slate-200/80 rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                    {FAQ_ITEMS.map((item) => (
                        <details key={item.q} className="group px-5 py-4">
                            <summary className="cursor-pointer list-none font-bold text-slate-950 [&::-webkit-details-marker]:hidden">
                                <span className="flex items-center justify-between gap-4">
                                    {item.q}
                                    <span aria-hidden className="text-emerald-600 transition-transform duration-200 group-open:rotate-45">
                                        +
                                    </span>
                                </span>
                            </summary>
                            <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
                        </details>
                    ))}
                </div>
            </div>
        </section>
    );
}
