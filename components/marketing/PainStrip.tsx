import { PAINS } from "@/lib/marketing/copy";

export function PainStrip() {
    return (
        <section aria-labelledby="dores" className="bg-slate-50">
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-20 sm:px-6 md:grid-cols-3 lg:py-24">
                <h2 id="dores" className="sr-only">
                    O que trava o delivery hoje
                </h2>
                {PAINS.map((pain) => (
                    <article
                        key={pain.title}
                        className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md"
                    >
                        <h3 className="font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight text-slate-950">
                            {pain.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">{pain.body}</p>
                    </article>
                ))}
            </div>
        </section>
    );
}
