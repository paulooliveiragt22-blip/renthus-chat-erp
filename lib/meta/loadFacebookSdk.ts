export type FacebookLoginResponse = {
    authResponse?: { code?: string };
    status?: string;
};

export type FacebookSdk = {
    init: (opts: {
        appId: string;
        autoLogAppEvents?: boolean;
        xfbml?: boolean;
        version: string;
    }) => void;
    login: (
        cb: (res: FacebookLoginResponse) => void,
        opts: Record<string, unknown>
    ) => void;
};

declare global {
    interface Window {
        FB?: FacebookSdk;
        fbAsyncInit?: () => void;
    }
}

const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

export function readCspNonce(): string {
    if (typeof document === "undefined") return "";
    return document.documentElement.getAttribute("data-csp-nonce") ?? "";
}

function graphVersionLabel(raw: string): string {
    const v = raw.trim() || "v20.0";
    return v.startsWith("v") ? v : `v${v}`;
}

export async function loadFacebookSdk(params: {
    appId: string;
    version: string;
}): Promise<FacebookSdk> {
    if (typeof window === "undefined") {
        throw new Error("facebook_sdk_window_unavailable");
    }
    if (window.FB) return window.FB;

    await new Promise<void>((resolve, reject) => {
        const prevInit = window.fbAsyncInit;
        window.fbAsyncInit = () => {
            prevInit?.();
            window.FB?.init({
                appId: params.appId,
                autoLogAppEvents: false,
                xfbml: false,
                version: graphVersionLabel(params.version),
            });
            resolve();
        };

        if (document.querySelector(`script[src="${FB_SDK_SRC}"]`)) {
            const started = Date.now();
            const t = window.setInterval(() => {
                if (window.FB) {
                    window.clearInterval(t);
                    window.FB.init({
                        appId: params.appId,
                        autoLogAppEvents: false,
                        xfbml: false,
                        version: graphVersionLabel(params.version),
                    });
                    resolve();
                } else if (Date.now() - started > 8000) {
                    window.clearInterval(t);
                    reject(new Error("facebook_sdk_timeout"));
                }
            }, 50);
            return;
        }

        const script = document.createElement("script");
        script.src = FB_SDK_SRC;
        script.async = true;
        script.defer = true;
        script.crossOrigin = "anonymous";
        const nonce = readCspNonce();
        if (nonce) script.nonce = nonce;
        script.onerror = () => reject(new Error("facebook_sdk_load_failed"));
        document.head.appendChild(script);
        window.setTimeout(() => {
            if (!window.FB) reject(new Error("facebook_sdk_timeout"));
        }, 12_000);
    });

    if (!window.FB) throw new Error("facebook_sdk_unavailable");
    return window.FB;
}

export function isFacebookSignupOrigin(origin: string): boolean {
    return origin === "https://www.facebook.com" || origin === "https://web.facebook.com";
}
