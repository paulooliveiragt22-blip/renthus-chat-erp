import type { AdminAlert } from "../domain/AdminAlert";

export type AlertFeed = {
    fetchAlerts(): Promise<AdminAlert[]>;
};

export type AlertPresenter = {
    present(alert: AdminAlert, opts?: { navigate: (href: string) => void }): void;
};

export type OsNotificationPort = {
    ensurePermission(): Promise<NotificationPermission | "unsupported">;
    show(alert: AdminAlert, opts: { onClick: () => void }): void;
};
