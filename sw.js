/* sw.js — offline app shell + buddy push. Bump CACHE when files change to force update. */
const CACHE = "forge-v98";
const SYNC_BASE = "https://forge-sync.nikvbas.workers.dev";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./program.js", "./app.js",
  "./manifest.json", "./icon.svg",
];

self.addEventListener("install", (e) => {
  // c.addAll() used default fetch caching, which can pull a STALE copy of an asset straight
  // from the browser's own HTTP cache even while installing a brand-new CACHE version — the SW
  // version bump is real and detected correctly, but the content it bakes in on install could
  // still be old. This is very likely the actual mechanism behind most of today's "I bumped the
  // version and it's still showing the old thing" reports. {cache:"reload"} forces every asset
  // fetch during install to bypass HTTP cache and hit the network for real, so a new CACHE
  // version now genuinely guarantees fresh content, not just a fresh cache key.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((url) => fetch(url, { cache: "reload" }).then((res) => c.put(url, res)))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Only ever cache same-origin app-shell requests (index.html, app.js, etc — the ASSETS list).
  // A cross-origin request — the sync worker's /state, buddy /group, /pending — must NEVER be
  // served from this cache: caches.match() matches purely by URL, completely ignoring headers,
  // so a single earlier GET to forge-sync.../state (whatever Authorization it carried, even an
  // empty/failed attempt) would get cached and then silently served FOREVER for every later
  // request to that exact URL, regardless of what Authorization header a later request actually
  // sends. This is almost certainly the real mechanism behind "same passphrase, one device sees
  // the data, another always gets 'no data found' no matter how many times it's retyped correctly"
  // — whichever device happened to cache an empty response first was stuck seeing that one
  // frozen response forever after, with no way for a correct retry to ever reach the network.
  if (new URL(e.request.url).origin !== self.location.origin) return; // let the browser fetch it directly — no caching, ever
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
