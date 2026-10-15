export function PromoBannerFace(props: {
    name: string;
    description?: string | null;
    packLabel?: string | null;
    /** Preço de catálogo, já formatado. Aparece riscado depois de "de:". */
    listPriceLabel?: string | null;
    /** Preço da promoção, já formatado. Aparece depois de "por:". */
    priceLabel?: string | null;
    imageUrl?: string | null;
}) {
    return (
        <div className="relative flex min-h-36 w-full flex-col justify-end overflow-hidden rounded-2xl">
            {props.imageUrl ? (
                <img src={props.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-r from-orange-600 to-zinc-900" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/15" />
            <div className="relative z-10 px-12 py-4 text-left sm:px-14">
                <div className="relative">
                    <p className="absolute bottom-full left-0 mb-1 text-[11px] font-semibold uppercase tracking-wider text-orange-100">
                        Promoção
                    </p>
                    <p className="text-lg font-bold leading-snug text-white sm:text-xl">{props.name}</p>
                    {props.description ? (
                        <p className="mt-1 whitespace-pre-line text-sm leading-snug text-white">{props.description}</p>
                    ) : null}
                    {props.packLabel ? (
                        <p className="mt-1 text-xs font-medium text-orange-100">{props.packLabel}</p>
                    ) : null}
                    {props.listPriceLabel ? (
                        <p className="mt-1 text-xs font-medium text-white/80">
                            de: <span className="line-through">{props.listPriceLabel}</span>
                        </p>
                    ) : null}
                    {props.priceLabel ? (
                        <p className="text-sm font-semibold text-white">por: {props.priceLabel}</p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
