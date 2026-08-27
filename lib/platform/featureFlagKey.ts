const KEY_RE = /^[a-z][a-z0-9_.-]{1,63}$/;

export function isValidFeatureFlagKey(key: string): boolean {
    return KEY_RE.test(key);
}
