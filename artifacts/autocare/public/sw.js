// AutoCare service worker — handles web push notifications for owners.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "AutoCare", body: "You have a new notification" };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "AutoCare", body: event.data.text() };
    }
  }
  const options = {
    body: data.body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if ("focus" in c) {
            c.navigate(targetUrl);
            return c.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      }),
  );
});
