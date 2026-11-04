import { HOW_STEPS, PRODUCT_BLOCKS } from "@/lib/marketing/copy";

export function ProductLoop() {
    return (
        <div>
            <section aria-labelledby="como-funciona" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
                <h2 id="como-funciona" className="text-2xl font-extrabold tracking-tight text-[#16364D] sm:text-3xl">
                    Do pedido ao caixa, no mesmo fluxo
                </h2>
                <ol className="mt-8 grid gap-4 md:grid-cols-3">
                    {HOW_STEPS.map((step, index) => (
                        <li key={step} className="rounded-2xl border border-[#16364D]/10 bg-white p-5">
                            <span className="inline-flex size-8 items-center justify-center rounded-full bg-[#57ff8f] text-sm font-extrabold text-[#16364D]">
                                {index + 1}
                            </span>
                            <p className="mt-3 text-sm leading-relaxed text-[#16364D]">{step}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <section aria-labelledby="produto" className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
                <h2 id="produto" className="text-2xl font-extrabold tracking-tight text-[#16364D] sm:text-3xl">
                    O que a loja passa a ter
                </h2>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                    {PRODUCT_BLOCKS.map((block) => (
                        <article key={block.title} className="rounded-2xl border border-[#16364D]/10 bg-white p-5">
                            <h3 className="text-lg font-extrabold text-[#16364D]">{block.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-[#16364D]/75">{block.body}</p>
                        </article>
                    ))}
                </div>
            </section>
        </div>
    );
}
