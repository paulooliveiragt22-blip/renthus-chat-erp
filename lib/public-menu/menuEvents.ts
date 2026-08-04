import { getOrCreateMenuVisitorId } from "@/lib/public-menu/visitorId";
import type { PublicMenuEventType } from "@/src/types/contracts.public-menu";

type UtmBundle = {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
};

function utmStorageKey(slug: string): string {
    return `renthus_menu_utm_${slug}`;
}

function viewedStorageKey(slug: string): string {
    return `renthus_menu_viewed_${slug}`;
}

/** Captura UTM/?ref da URL e persiste na sessão do browser. */
export function captureMenuUtmFromLocation(slug: string): UtmBundle {
    if (typeof globalThis.window === "undefined") {
        return { utmSource: null, utmMedium: null, utmCampaign: null };
    }
    const params = new URLSearchParams(globalThis.location.search);
    const ref = params.get("ref");
    const fromUrl: UtmBundle = {
        utmSource: params.get("utm_source") || (ref ? "ref" : null),
        utmMedium: params.get("utm_medium"),
        utmCampaign: params.get("utm_campaign") || ref,
    };
    const hasAny = Boolean(fromUrl.utmSource || fromUrl.utmMedium || fromUrl.utmCampaign);
    try {
        if (hasAny) {
            globalThis.sessionStorage?.setItem(utmStorageKey(slug), JSON.stringify(fromUrl));
            return fromUrl;
        }
        const raw = globalThis.sessionStorage?.getItem(utmStorageKey(slug));
        if (!raw) return fromUrl;
        const parsed = JSON.parse(raw) as Partial<UtmBundle>;
        return {
            utmSource: typeof parsed.utmSource === "string" ? parsed.utmSource : null,
            utmMedium: typeof parsed.utmMedium === "string" ? parsed.utmMedium : null,
            utmCampaign: typeof parsed.utmCampaign === "string" ? parsed.utmCampaign : null,
        };
    } catch {
        return fromUrl;
    }
}

function alreadyTrackedProduct(slug: string, embalagemId: string): boolean {
    try {
        const raw = globalThis.sessionStorage?.getItem(viewedStorageKey(slug));
        if (!raw) return false;
        const ids = JSON.parse(raw) as string[];
        return Array.isArray(ids) && ids.includes(embalagemId);
    } catch {
        return false;
    }
}

function markTrackedProduct(slug: string, embalagemId: string): void {
    try {
        const key = viewedStorageKey(slug);
        const raw = globalThis.sessionStorage?.getItem(key);
        const ids = raw ? (JSON.parse(raw) as string[]) : [];
        const next = Array.isArray(ids) ? ids : [];
        if (!next.includes(embalagemId)) next.push(embalagemId);
        globalThis.sessionStorage?.setItem(key, JSON.stringify(next.slice(-80)));
    } catch {
        /* ignore */
    }
}

export function trackMenuEvent(params: {
    slug: string;
    eventType: PublicMenuEventType;
    productId?: string | null;
    categoryId?: string | null;
    embalagemId?: string | null;
}): void {
    if (typeof globalThis.window === "undefined") return;
    const utm = captureMenuUtmFromLocation(params.slug);
    const visitorId = getOrCreateMenuVisitorId();
    void fetch(`/api/public/menu/${encodeURIComponent(params.slug)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            visitorId,
            eventType: params.eventType,
            productId: params.productId ?? null,
            categoryId: params.categoryId ?? null,
            embalagemId: params.embalagemId ?? null,
            utmSource: utm.utmSource,
            utmMedium: utm.utmMedium,
            utmCampaign: utm.utmCampaign,
            referrer: document.referrer || null,
        }),
    }).catch(() => {});
}

/** product_view uma vez por embalagem na sessão (evita spam no +/-). */
export function trackMenuProductViewOnce(params: {
    slug: string;
    productId: string;
    categoryId?: string | null;
    embalagemId: string;
}): void {
    if (alreadyTrackedProduct(params.slug, params.embalagemId)) return;
    markTrackedProduct(params.slug, params.embalagemId);
    trackMenuEvent({
        slug: params.slug,
        eventType: "product_view",
        productId: params.productId,
        categoryId: params.categoryId ?? null,
        embalagemId: params.embalagemId,
    });
}
