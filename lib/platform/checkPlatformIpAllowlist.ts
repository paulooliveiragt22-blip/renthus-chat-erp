function isProductionEnv(): boolean {
    return (
        process.env.VERCEL_ENV === "production" ||
        process.env.NODE_ENV === "production"
    );
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const v = Number(p);
        if (!Number.isInteger(v) || v < 0 || v > 255) return null;
        n = (n << 8) + v;
    }
    return n >>> 0;
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
    const [base, bitsStr] = cidr.split("/");
    const bits = bitsStr ? Number(bitsStr) : 32;
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

    const ipInt = ipv4ToInt(ip);
    const baseInt = ipv4ToInt(base);
    if (ipInt === null || baseInt === null) return false;

    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
}

function parseAllowlist(raw: string): string[] {
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

export function extractClientIp(forwardedFor: string | null, realIp: string | null): string {
    if (forwardedFor) {
        const first = forwardedFor.split(",")[0]?.trim();
        if (first) return first;
    }
    return realIp?.trim() ?? "";
}

export function isIpAllowed(clientIp: string, allowlistCsv: string | undefined): boolean {
    if (!isProductionEnv()) return true;

    const list = parseAllowlist(allowlistCsv ?? process.env.PLATFORM_ADMIN_IP_ALLOWLIST ?? "");
    if (list.length === 0) return false;

    const ip = clientIp.trim();
    if (!ip) return false;

    for (const entry of list) {
        if (entry.includes("/")) {
            if (ipMatchesCidr(ip, entry)) return true;
        } else if (ip === entry) {
            return true;
        }
    }
    return false;
}

export function checkPlatformIpAllowlist(headers: {
    get(name: string): string | null;
}): { ok: true } | { ok: false; reason: string } {
    const ip = extractClientIp(
        headers.get("x-forwarded-for"),
        headers.get("x-real-ip")
    );
    if (isIpAllowed(ip, process.env.PLATFORM_ADMIN_IP_ALLOWLIST)) {
        return { ok: true };
    }
    return { ok: false, reason: "ip_not_allowed" };
}
