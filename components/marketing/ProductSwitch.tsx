import { attendanceLandingHref, deliveryLandingHref } from "@/lib/marketing/hosts";
import { OFFICE_LANDING_VISIBLE } from "@/lib/marketing/officeLanding";
import { cn } from "@/lib/utils";

type MarketingProduct = "delivery" | "office";

function productClass(active: boolean) {
    return cn(
        "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-200",
        active ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-white"
    );
}

export function ProductSwitch({
    product,
    linkToApp = false,
}: {
    product: MarketingProduct;
    linkToApp?: boolean;
}) {
    if (!OFFICE_LANDING_VISIBLE) return null;

    const deliveryHref = deliveryLandingHref(linkToApp);
    const officeHref = attendanceLandingHref(linkToApp);

    return (
        <nav
            aria-label="Produtos"
            className="mb-8 inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5"
        >
            <a href={deliveryHref} aria-current={product === "delivery" ? "page" : undefined} className={productClass(product === "delivery")}>
                Delivery
            </a>
            <a href={officeHref} aria-current={product === "office" ? "page" : undefined} className={productClass(product === "office")}>
                Office
            </a>
        </nav>
    );
}
