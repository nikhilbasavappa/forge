/* sw.js — offline app shell + buddy push. Bump CACHE when files change to force update. */
const CACHE = "forge-v70";
const SYNC_BASE = "https://forge-sync.nikvbas.workers.dev";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./program.js", "./app.js",
  "./manifest.json", "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => hit)
    )
  );
});

/* ---- buddy push: SW knows its identity via IndexedDB, fetches the message text on push ---- */
function buddyIdentity() {
  return new Promise((res) => {
    const r = indexedDB.open("forge-buddy", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("id")) r.result.createObjectStore("id"); };
    r.onsuccess = () => {
      try { const g = r.result.transaction("id", "readonly").objectStore("id").get("me");
        g.onsuccess = () => res(g.result || null); g.onerror = () => res(null);
      } catch (e) { res(null); }
    };
    r.onerror = () => res(null);
  });
}
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let body = "A buddy is on the move — open Forge.";
    try {
      const id = await buddyIdentity();
      if (id && id.group && id.name) {
        const r = await fetch(`${SYNC_BASE}/pending?group=${encodeURIComponent(id.group)}&name=${encodeURIComponent(id.name)}`);
        if (r.ok) { const msgs = (await r.json()).messages || []; if (msgs.length) body = msgs.join(" · "); }
      }
    } catch (e) {}
    await self.registration.showNotification("Forge", { body, icon: "./icon.svg", badge: "./icon.svg", tag: "forge-buddy", renotify: true });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of cs) if ("focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow("./index.html");
  })());
});
