import { TESTIMONIALS, TRUST_METRICS } from "@/lib/marketing/copy";

export function SocialProof() {
    return (
        <section aria-labelledby="prova" className="bg-white">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
            <h2 id="prova" className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
                Loja de bebida, adega e lanche já fecham o pedido no próprio número
            </h2>
            <dl className="mt-8 grid gap-3 sm:grid-cols-3">
                {TRUST_METRICS.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-slate-200/80 bg-white px-4 py-5 shadow-sm">
                        <dt className="font-[family-name:var(--font-landing-display)] text-2xl font-extrabold tracking-tight text-emerald-700 tabular-nums">{metric.value}</dt>
                        <dd className="mt-1 text-sm leading-relaxed text-slate-600">{metric.label}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {TESTIMONIALS.map((item) => (
                    <figure key={item.name} className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md">
                        <blockquote className="text-sm leading-relaxed text-slate-700">
                            “{item.quote}”
                        </blockquote>
                        <figcaption className="mt-4 flex items-center gap-3">
                            <span
                                aria-hidden
                                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-extrabold text-emerald-300"
                            >
                                {item.initials}
                            </span>
                            <span>
                                <span className="block text-sm font-extrabold text-slate-950">{item.name}</span>
                                <span className="block text-xs text-slate-500">
                                    {item.store} · {item.city}
                                </span>
                            </span>
                        </figcaption>
                    </figure>
                ))}
            </div>
            </div>
        </section>
    );
}
