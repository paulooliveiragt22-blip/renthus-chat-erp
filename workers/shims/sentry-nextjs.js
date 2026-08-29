/** Minimal Sentry stub for Lambda workers (avoids bundling @sentry/nextjs). */
module.exports = {
    captureException() {},
    captureMessage() {},
    setTag() {},
    setUser() {},
    addBreadcrumb() {},
    withScope(cb) {
        if (typeof cb === "function") cb({ setTag() {}, setExtra() {}, setContext() {} });
    },
};
