// Yai Calendar — offline app shell, served at /sw.js.
// The page opens at once from the device and is refreshed in the background; a new version shows
// "New version — tap to reload". Fonts never change under their URL, so they're kept. /api/* is never cached.

const SHELL = "yai-shell-v137";            // bump to make every device drop its copy
// Paths are taken from the worker's own scope, so it works at "/" and under a sub-path (GitHub Pages).
const BASE = new URL(self.registration.scope).pathname;
const PAGES = [BASE, BASE + "journal"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(PAGES.map((p) => fetch(p, { cache: "no-cache" }).then((r) => r.ok && c.put(p, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === BASE + "sw.js") return;
  if (req.mode === "navigate" && PAGES.includes(url.pathname)) return e.respondWith(page(e, url.pathname));
  if (url.pathname.startsWith(BASE + "static/fonts/")) return e.respondWith(kept(req));
});

async function page(e, path) {
  const c = await caches.open(SHELL);
  const hit = await c.match(path);
  const net = fetch(path, { cache: "no-cache", credentials: "same-origin" }).then(async (r) => {
    if (r.ok) {
      const before = hit && hit.headers.get("etag");
      await c.put(path, r.clone());
      if (before && before !== r.headers.get("etag")) {
        for (const w of await self.clients.matchAll({ type: "window" }))
          if (new URL(w.url).pathname === path) w.postMessage({ type: "odin:updated" });
      }
    }
    return r;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  try { return await net; } catch { return new Response("Offline — and this page isn't on this device yet.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); }
}

async function kept(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) await c.put(req, r.clone());
  return r;
}

// Reminders: the backend pushes { title, body, date, tag } a week and a day before events (src/reminders.ts).
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: "Yai Calendar", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Yai Calendar", {
    body: m.body || "", tag: m.tag || undefined, renotify: !!m.tag,
    icon: BASE + "static/icon-192.png", badge: BASE + "static/icon-192.png",
    data: { date: m.date || "" },
  }));
});

// Tapping one opens the app on that day (reusing an open window if there is one).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const date = (e.notification.data && e.notification.data.date) || "";
  const url = self.registration.scope + (date ? "?day=" + date : "");
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith(BASE)) {
        w.postMessage({ type: "yai:open-day", date });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
