// sw.js
const TAG = "seishotsudoku-daily";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      try {
        const txt = event.data ? await event.data.text() : "";
        data = txt ? JSON.parse(txt) : {};
      } catch {
        data = {};
      }
    }

    const title = data.title || "聖書通読";
    const url = data.url || "/";

    // ★同じTAGの通知を消してから1件だけ出す（バッジが溜まらない）
    const old = await self.registration.getNotifications({ tag: TAG });
    old.forEach((n) => n.close());

    await self.registration.showNotification(title, {
      body: data.body || "",
      tag: TAG,
      renotify: false,
      requireInteraction: false,
      data: { url },
      // icon: "/seishotsudoku/icons/icon-192.png", // 置いてあるなら有効化
      // badge: "/seishotsudoku/icons/badge-72.png", // あれば
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";

  event.waitUntil((async () => {
    // ★クリック時にも同TAG通知を消す（バッジ減りやすい）
    const old = await self.registration.getNotifications({ tag: TAG });
    old.forEach((n) => n.close());

    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of allClients) {
      if (c.url === url && "focus" in c) return c.focus();
    }
    return clients.openWindow(url);
  })());
});
// sw.js のどこか（末尾あたり）に追加
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_NOTIFICATIONS") return;

  event.waitUntil((async () => {
    const notifs = await self.registration.getNotifications();
    notifs.forEach((n) => n.close());
  })());
});
