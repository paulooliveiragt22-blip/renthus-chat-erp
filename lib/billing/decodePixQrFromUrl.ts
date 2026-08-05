/**
 * Quando o Pagar.me/Mundipagg devolve só URL de imagem/página PIX (sem EMV),
 * tenta recuperar o copia-e-cola decodificando o QR ou varrendo o HTML.
 */

import "server-only";
import sharp from "sharp";
import jsQR from "jsqr";
import { isImageMagic, isPixEmvPayload, pickPixEmvFromText } from "@/lib/billing/pixEmv";

/** Pipelines → RGBA (jsQR exige 4 canais). */
async function decodeEmvFromImageBuffer(buf: Buffer): Promise<string | null> {
    const pipelines: Array<(img: sharp.Sharp) => sharp.Sharp> = [
        (img) => img.rotate().flatten({ background: "#ffffff" }),
        (img) =>
            img.rotate().greyscale().normalize().toColorspace("srgb").flatten({
                background: "#ffffff",
            }),
        (img) =>
            img
                .rotate()
                .resize(512, 512, { fit: "inside", withoutEnlargement: false })
                .flatten({ background: "#ffffff" }),
        (img) =>
            img
                .rotate()
                .greyscale()
                .normalize()
                .resize(640, 640, { fit: "inside", withoutEnlargement: false })
                .toColorspace("srgb")
                .flatten({ background: "#ffffff" }),
    ];

    for (const prep of pipelines) {
        try {
            const { data, info } = await prep(sharp(buf))
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            if (info.channels !== 4) continue;
            const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
                inversionAttempts: "attemptBoth",
            });
            if (!code?.data) continue;
            const emv = pickPixEmvFromText(code.data);
            if (emv) return emv;
        } catch {
            // tenta próximo pipeline
        }
    }
    return null;
}

/** Decodifica QR de imagem (PNG/JPEG/WebP) → EMV PIX. */
export async function decodePixEmvFromImageUrl(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, {
            redirect: "follow",
            headers: { Accept: "image/*,*/*" },
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (isImageMagic(buf)) {
            return decodeEmvFromImageBuffer(buf);
        }
        // Resposta não-imagem (HTML/JSON): só aceitar EMV textual
        return pickPixEmvFromText(buf.toString("utf8"));
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
        const buf = Buffer.from(await res.arrayBuffer());
        // Nunca tratar PNG/JPEG como “página” — isso gerava lixo �…IEND no textarea
        if (isImageMagic(buf)) {
            return decodeEmvFromImageBuffer(buf);
        }
        return pickPixEmvFromText(buf.toString("utf8"));
    } catch (e) {
        console.warn("[pagarme] extract PIX EMV from page failed:", e);
        return null;
    }
}

/** Tenta imagem e, se falhar / URL for página, HTML. */
export async function recoverPixEmvFromUrl(url: string): Promise<string | null> {
    if (!url.startsWith("http")) return null;
    const fromImage = await decodePixEmvFromImageUrl(url);
    if (fromImage && isPixEmvPayload(fromImage)) return fromImage;
    const fromPage = await extractPixEmvFromPageUrl(url);
    if (fromPage && isPixEmvPayload(fromPage)) return fromPage;
    return null;
}
