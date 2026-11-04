import { PAINS } from "@/lib/marketing/copy";

export function PainStrip() {
    return (
        <section aria-labelledby="dores" className="border-y border-[#16364D]/10 bg-white">
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
                <h2 id="dores" className="sr-only">
                    O que trava o delivery hoje
                </h2>
                {PAINS.map((pain) => (
                    <article key={pain.title}>
                        <h3 className="text-lg font-extrabold text-[#16364D]">{pain.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-[#16364D]/75">{pain.body}</p>
                    </article>
                ))}
            </div>
        </section>
    );
}
