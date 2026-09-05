import { NextResponse, type NextRequest } from "next/server";
import {
    buildContentSecurityPolicy,
    CSP_ENFORCE_HEADER,
    X_FRAME_OPTIONS_DENY,
    X_NONCE_HEADER,
} from "@/lib/security/cspPolicy";
import {
    buildCspReportToHeader,
    buildReportingEndpointsHeader,
    sentrySecurityReportUrl,
} from "@/lib/security/sentryCspReport";

export type CspContext = {
    nonce: string;
    value: string;
    reportUri: string | null;
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
    const reportUri = sentrySecurityReportUrl(
        process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN
    );
    return {
        nonce,
        value: buildContentSecurityPolicy({
            isDev,
            nonce,
            reportUri: reportUri ?? undefined,
        }),
        reportUri,
    };
}

export function stampCspResponse(response: NextResponse, ctx: CspContext): NextResponse {
    response.headers.set(CSP_ENFORCE_HEADER, ctx.value);
    response.headers.set("X-Frame-Options", X_FRAME_OPTIONS_DENY);
    if (ctx.reportUri) {
        response.headers.set("Report-To", buildCspReportToHeader(ctx.reportUri));
        response.headers.set("Reporting-Endpoints", buildReportingEndpointsHeader(ctx.reportUri));
    }
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
        ctx
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
        ctx
    );
}
