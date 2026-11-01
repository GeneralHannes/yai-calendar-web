// Retires the old Flutter version's offline worker.
//
// Before the rename, the Flutter build of Yai Calendar lived at this same address and registered
// flutter_service_worker.js here. Devices that opened it still have that worker, and it keeps serving the old
// Flutter app from its cache, so the current app never loads. Browsers re-check a worker's script for updates;
// this file is what they now find (the build copies it to the site root). It installs at once, deletes only the
// Flutter caches, unregisters itself and reloads open windows into the current app.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("flutter")) await caches.delete(k);
    await self.registration.unregister();
    for (const w of await self.clients.matchAll({ type: "window" })) w.navigate(w.url).catch(() => {});
  })());
});
