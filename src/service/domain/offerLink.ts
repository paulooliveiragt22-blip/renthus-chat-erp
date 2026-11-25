export const OFFER_LINK_LABELS = ["Ver oferta", "Ver plano", "Ver serviço"] as const;

export type OfferLinkLabel = (typeof OFFER_LINK_LABELS)[number];

export function offerLinkLabel(value: string | null | undefined): OfferLinkLabel {
    if (value && (OFFER_LINK_LABELS as readonly string[]).includes(value)) {
        return value as OfferLinkLabel;
    }
    return "Ver oferta";
}

export function httpsOfferLink(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    if (!trimmed.startsWith("https://") || trimmed.length > 500) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "https:") return null;
        if (!url.hostname) return null;
        return trimmed;
    } catch {
        return null;
    }
}
