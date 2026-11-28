export const SITE_VISITOR_COOKIE = "zampell_site_visitor";

export const SITE_VISIT_PATH = "/";

export const SITE_AUDIENCE_DAYS = [1, 7, 30] as const;

export type SiteAudienceDays = (typeof SITE_AUDIENCE_DAYS)[number];

export function parseSiteAudienceDays(raw: string | null): SiteAudienceDays {
    if (raw === "7" || raw === "30") return Number(raw) as SiteAudienceDays;
    return 1;
}
