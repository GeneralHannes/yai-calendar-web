// Odin's Journal — offline app shell, served at /sw.js.
// The page opens at once from the device and is refreshed in the background; a new version shows
// "New version — tap to reload". Fonts never change under their URL, so they're kept. /api/* is never cached.

const SHELL = "journal-shell-v2";            // bump to make every device drop its copy
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
