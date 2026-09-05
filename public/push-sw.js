/* global self, clients */
/**
 * Handlers de Web Push (importados pelo SW do next-pwa).
 * Payload JSON: { title, body, href, tag }
 */
self.addEventListener("push", (event) => {
  let data = { title: "Renthus", body: "Nova notificação", href: "/", tag: "renthus" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    self.registration.showNotification(String(data.title || "Renthus"), {
      body: String(data.body || ""),
      tag: String(data.tag || "renthus"),
      renotify: true,
      data: { href: String(data.href || "/") },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href =
    (event.notification.data && event.notification.data.href) || "/";
  const url = new URL(href, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.postMessage({ type: "ADMIN_ALERT_NAV", href });
          return client.focus().then(() => {
            if ("navigate" in client) return client.navigate(url);
          });
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
