self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const target = new URL(data.url || "", self.registration.scope).href;

  event.waitUntil(
    self.registration.showNotification(data.title || "聖書通読", {
      body: data.body || "",
      data: { url: target },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification?.data?.url || "", self.registration.scope).href;

  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === target && "focus" in w) return w.focus();
    }
    return clients.openWindow(target);
  })());
});
