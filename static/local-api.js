// Serverless mode. The page talks to /api/journal/*; on a host with no Journal server (GitHub Pages) that
// answer never comes, so this keeps the events in this browser's localStorage and answers the same calls.
// With a real server behind the page it stays out of the way.
(function () {
  const real = window.fetch.bind(window);
  const KEY = "journal_local_events";
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
  // the static build sets JOURNAL_STATIC: there's no server to ask about, so don't wait on a request to find out
  let mode = window.JOURNAL_STATIC ? Promise.resolve("local") : null;

  const hasServer = () =>
    mode || (mode = real("/api/auth").then((r) => r.json()).then((a) => (typeof a?.required === "boolean" ? "server" : "local"), () => "local"));

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { next: 1, events: [] }; } catch (_) { return { next: 1, events: [] }; } };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {} };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fail = (status, detail) => reply({ detail }, status);
  const secs = (t) => (t ? (t.length === 5 ? t + ":00" : t) : null);
  const now = () => new Date().toISOString();
  const COLOR = (c) => (["blue", "green", "yellow", "orange", "red", "purple", "teal", "sky"].includes(str(c).toLowerCase()) ? str(c).toLowerCase() : null);
  const str = (v) => (v ?? "").toString().trim();
  const order = (a, b) =>
    a.event_date.localeCompare(b.event_date) ||
    (a.event_time ? 1 : 0) - (b.event_time ? 1 : 0) ||
    (a.event_time || "").localeCompare(b.event_time || "") ||
    a.id - b.id;

  async function local(method, path, body) {
    const db = load();
    if (path === "/api/auth") return reply({ required: false });
    if (path === "/api/journal/events" && method === "GET") return reply(db.events.slice().sort(order));
    if (path === "/api/journal/events" && method === "POST") {
      const title = str(body.title), event_date = str(body.event_date), event_time = str(body.event_time) || null;
      if (!title) return fail(400, "title is required");
      if (!DATE_RE.test(event_date)) return fail(400, "event_date must be YYYY-MM-DD");
      if (event_time && !TIME_RE.test(event_time)) return fail(400, "event_time must be HH:MM");
      const ev = { id: db.next++, event_date, event_time: secs(event_time), end_date: null, end_time: null, day_info: null, color: COLOR(body.color),
        location: str(body.location) || null, title, notes: str(body.notes) || null,
        category: str(body.category) || null, status: ["tentative", "cancelled"].includes(body.status) ? body.status : null, done: false, created_at: now(), updated_at: now() };
      const why = setSpan(ev, body); if (why) return fail(400, why);
      db.events.push(ev); save(db); return reply(ev, 201);
    }
    const m = path.match(/^\/api\/journal\/events\/(\d+)(\/done)?$/);
    if (!m) return fail(404, "not found");
    const id = +m[1], ev = db.events.find((e) => e.id === id);
    if (!ev) return fail(404, "no event #" + id);
    if (method === "DELETE") { db.events = db.events.filter((e) => e.id !== id); save(db); return reply({ deleted: id }); }
    if (m[2]) { ev.done = !!body.done; ev.updated_at = now(); save(db); return reply(ev); }
    if ("title" in body) { const t = str(body.title); if (!t) return fail(400, "title cannot be blank"); ev.title = t; }
    if ("event_date" in body) { const d = str(body.event_date); if (!DATE_RE.test(d)) return fail(400, "event_date must be YYYY-MM-DD"); ev.event_date = d; }
    if ("event_time" in body) { const t = str(body.event_time); if (t && !TIME_RE.test(t)) return fail(400, "event_time must be HH:MM"); ev.event_time = secs(t) || null; }
    if ("notes" in body) ev.notes = str(body.notes) || null;
    if ("category" in body) ev.category = str(body.category) || null;
    if ("status" in body) ev.status = ["tentative", "cancelled"].includes(body.status) ? body.status : null;
    if ("location" in body) ev.location = str(body.location) || null;
    if ("color" in body) ev.color = COLOR(body.color);
    if ("event_time" in body && !ev.event_time) ev.end_time = null;   // all day now: no end time either
    const was = { ...ev }, why = setSpan(ev, body);
    if (why) { Object.assign(ev, was); return fail(400, why); }
    ev.updated_at = now(); save(db); return reply(ev);
  }

  // end_date / end_time from the body (when given), made consistent the same way the backends do
  function setSpan(ev, body) {
    if ("end_date" in body) { const d = str(body.end_date); if (d && !DATE_RE.test(d)) return "end_date must be YYYY-MM-DD"; ev.end_date = d || null; }
    if ("end_time" in body) { const t = str(body.end_time); if (t && !TIME_RE.test(t)) return "end_time must be HH:MM"; ev.end_time = secs(t) || null; }
    if (ev.end_date && ev.end_date <= ev.event_date) { if (ev.end_date < ev.event_date) return "the end date is before the start"; ev.end_date = null; }
    if (ev.end_time && !ev.event_time) return "give a start time too";
    if (!ev.end_date && ev.end_time && ev.end_time <= ev.event_time) return "the end time is before the start";
    // a multi-day event's own details for single days: as sent (checked), or what it had, kept where they still fit
    const sent = "day_info" in body, out = {};
    const d = sent ? body.day_info : ev.day_info;
    if (ev.end_date && d && typeof d === "object" && !Array.isArray(d)) {
      for (const [day, v] of Object.entries(d)) {
        if (!DATE_RE.test(day) || day < ev.event_date || day > ev.end_date || !v || typeof v !== "object") continue;
        const t = secs(str(v.event_time)) || null, t2 = secs(str(v.end_time)) || null;
        let why = null;
        if ((v.event_time && !TIME_RE.test(str(v.event_time))) || (v.end_time && !TIME_RE.test(str(v.end_time)))) why = "event_time must be HH:MM";
        else if (t2 && !(t || ev.event_time)) why = "give a start time too";
        else if (t2 && t2 <= (t || ev.event_time)) why = "the end time is before the start";
        if (why) { if (sent) return why; continue; }
        const one = {};
        if (t) one.event_time = t;
        if (t2) one.end_time = t2;
        if (str(v.location)) one.location = str(v.location);
        if (str(v.notes)) one.notes = str(v.notes);
        if (Object.keys(one).length) out[day] = one;
      }
    }
    ev.day_info = Object.keys(out).length ? out : null;
    return null;
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const u = new URL(url, location.href), path = u.pathname;
    // a backend at another address (JR_API in index.html) is always asked for real
    if (u.origin !== location.origin || !path.startsWith("/api/") || (await hasServer()) === "server") return real(input, init);
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) {}
    return local(((init && init.method) || "GET").toUpperCase(), path, body);
  };
})();
