import { NextResponse, type NextRequest } from "next/server";
import {
    buildContentSecurityPolicy,
    CSP_ENFORCE_HEADER,
    X_FRAME_OPTIONS_DENY,
    X_NONCE_HEADER,
} from "@/lib/security/cspPolicy";

export type CspContext = {
    nonce: string;
    value: string;
};

function requestHeadersWithCsp(request: NextRequest, ctx: CspContext, extra?: Headers): Headers {
    const headers = extra ? new Headers(extra) : new Headers(request.headers);
    headers.set(X_NONCE_HEADER, ctx.nonce);
    headers.set(CSP_ENFORCE_HEADER, ctx.value);
    return headers;
}

export function createCspContext(
    isDev = process.env.NODE_ENV === "development"
): CspContext {
    // Guia Next.js CSP: nonce por request. crypto.randomUUID é Web Crypto (Edge + Node).
    const nonce = Buffer.from(globalThis.crypto.randomUUID()).toString("base64");
    return { nonce, value: buildContentSecurityPolicy({ isDev, nonce }) };
}

export function stampCspResponse(response: NextResponse, csp: string): NextResponse {
    response.headers.set(CSP_ENFORCE_HEADER, csp);
    response.headers.set("X-Frame-Options", X_FRAME_OPTIONS_DENY);
    return response;
}

export function nextWithCsp(
    request: NextRequest,
    ctx: CspContext,
    extraRequestHeaders?: Headers
): NextResponse {
    return stampCspResponse(
        NextResponse.next({
            request: { headers: requestHeadersWithCsp(request, ctx, extraRequestHeaders) },
        }),
        ctx.value
    );
}

export function rewriteWithCsp(
    request: NextRequest,
    destination: URL,
    ctx: CspContext
): NextResponse {
    return stampCspResponse(
        NextResponse.rewrite(destination, {
            request: { headers: requestHeadersWithCsp(request, ctx) },
        }),
        ctx.value
    );
}
