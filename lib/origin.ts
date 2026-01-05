export function resolveSiteOrigin() {
    if (typeof window === "undefined") {
        return (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    }

    return window.location.origin;
}
