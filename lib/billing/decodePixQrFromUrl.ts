/**
 * Quando o Pagar.me/Mundipagg devolve só URL de imagem/página PIX (sem EMV),
 * tenta recuperar o copia-e-cola decodificando o QR ou varrendo o HTML.
 */

import "server-only";
import sharp from "sharp";
import jsQR from "jsqr";

function looksLikePixEmv(raw: string): boolean {
    const s = raw.trim();
    if (!s || s.startsWith("http://") || s.startsWith("https://")) return false;
    if (s.startsWith("000201")) return true;
    return s.length >= 40 && !s.includes("://");
}

function pickEmvFromText(text: string): string | null {
    const trimmed = text.trim();
    if (looksLikePixEmv(trimmed)) return trimmed;
    const m = text.match(/000201[\x20-\x7E]{30,800}/);
    if (!m?.[0]) return null;
    const candidate = m[0].trim();
    return looksLikePixEmv(candidate) ? candidate : null;
}

/** Decodifica QR de imagem (PNG/JPEG/WebP) → EMV PIX. */
export async function decodePixEmvFromImageUrl(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, {
            redirect: "follow",
            headers: { Accept: "image/*,*/*" },
        });
        if (!res.ok) return null;
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        const buf = Buffer.from(await res.arrayBuffer());
        if (contentType.includes("text/html") || buf.subarray(0, 15).toString("utf8").includes("<!DOCTYPE")) {
            return pickEmvFromText(buf.toString("utf8"));
        }
        const { data, info } = await sharp(buf)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
        if (!code?.data) return null;
        return pickEmvFromText(code.data);
    } catch (e) {
        console.warn("[pagarme] decode PIX QR image failed:", e);
        return null;
    }
}

/** Página Mundipagg (`digital.mundipagg.com/pix/...`) às vezes embute o EMV no HTML. */
export async function extractPixEmvFromPageUrl(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, {
            redirect: "follow",
            headers: { Accept: "text/html,application/json,*/*" },
        });
        if (!res.ok) return null;
        const text = await res.text();
        return pickEmvFromText(text);
    } catch (e) {
        console.warn("[pagarme] extract PIX EMV from page failed:", e);
        return null;
    }
}

/** Tenta imagem e, se falhar / URL for página, HTML. */
export async function recoverPixEmvFromUrl(url: string): Promise<string | null> {
    if (!url.startsWith("http")) return null;
    const fromImage = await decodePixEmvFromImageUrl(url);
    if (fromImage) return fromImage;
    return extractPixEmvFromPageUrl(url);
}
