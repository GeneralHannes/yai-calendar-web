// Supabase mode. The page talks to /api/* at JR_API (index.html). When static/config.json names a Supabase
// project — {"api": "https://<ref>.supabase.co", "supabase_key": "<its publishable/anon key>"} — this answers
// the calls to that address through the yai_* database functions from supabase/schema.sql instead, so the
// page itself doesn't know or care which backend it has. Anything else passes straight through.
(function () {
  const real = window.fetch.bind(window);
  const STORE = "yai_supabase";

  // {origin, key} from config.json, remembered so it's still known with no signal
  let confP = null;
  const conf = () => confP || (confP = real("static/config.json?" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((c) => {
      const k = (c.supabase_key || "").trim(), o = k && c.api ? new URL(c.api).origin : "";
      try { localStorage.setItem(STORE, JSON.stringify({ origin: o, key: k })); } catch (_) {}
      return { origin: o, key: k };
    })
    .catch(() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (_) { return {}; } }));
  const key = async () => (await conf()).key || "";

  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const header = (h, name) => !h ? "" : typeof h.get === "function" ? h.get(name) || "" :
    Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1] || "";

  async function rpc(origin, fn, args) {
    const k = await key();
    const headers = { "content-type": "application/json", apikey: k };
    if (k.startsWith("eyJ")) headers.authorization = "Bearer " + k;   // older (JWT) anon keys want both
    const r = await real(`${origin}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    const d = await r.json().catch(() => null);
    if (!r.ok) return reply({ detail: d?.message || r.statusText }, r.status);
    if (d && typeof d === "object" && !Array.isArray(d) && d.error) return reply({ detail: d.error }, d.status || 400);
    return reply(d);
  }

  async function answer(origin, method, path, body, token) {
    const ev = path.match(/^\/api\/journal\/events\/(\d+)(\/done)?$/);
    if (path === "/api/auth") return rpc(origin, "yai_auth", {});
    if (path === "/api/signup" && method === "POST")
      return rpc(origin, "yai_signup", { p_username: body.username ?? "", p_password: body.password ?? "", p_name: body.name ?? "", p_code: body.code ?? "" });
    if (path === "/api/login" && method === "POST") return rpc(origin, "yai_login", { p_username: body.username ?? "", p_password: body.password ?? "" });
    if (path === "/api/login/code" && method === "POST") return rpc(origin, "yai_login_code", { p_ticket: body.ticket ?? "", p_code: body.code ?? "" });
    if (path === "/api/password" && method === "POST") return rpc(origin, "yai_change_password", { p_token: token, p_current: body.current ?? "", p_new: body.password ?? "" });
    if (path === "/api/totp/begin" && method === "POST") return rpc(origin, "yai_totp_begin", { p_token: token });
    if (path === "/api/totp/confirm" && method === "POST") return rpc(origin, "yai_totp_confirm", { p_token: token, p_code: body.code ?? "" });
    if (path === "/api/totp/disable" && method === "POST") return rpc(origin, "yai_totp_disable", { p_token: token, p_password: body.password ?? "" });
    if (path === "/api/audit") return rpc(origin, "yai_audit", { p_token: token });
    if (path === "/api/logout") return rpc(origin, "yai_logout", { p_token: token });
    if (path === "/api/me") return rpc(origin, "yai_me", { p_token: token });
    if (path === "/api/users" && method === "GET") return rpc(origin, "yai_users", { p_token: token });
    const us = path.match(/^\/api\/users\/(\d+)(\/role)?$/);
    if (us && us[2] && method === "POST") return rpc(origin, "yai_set_role", { p_token: token, p_id: +us[1], p_role: body.role ?? "" });
    const us2 = path.match(/^\/api\/users\/(\d+)\/(password|reset2fa)$/);
    if (us2 && us2[2] === "password" && method === "POST") return rpc(origin, "yai_admin_set_password", { p_token: token, p_id: +us2[1], p_password: body.password ?? "" });
    if (us2 && us2[2] === "reset2fa" && method === "POST") return rpc(origin, "yai_admin_reset_2fa", { p_token: token, p_id: +us2[1] });
    if (us && !us[2] && method === "DELETE") return rpc(origin, "yai_remove_user", { p_token: token, p_id: +us[1] });
    if (path === "/api/people" && method === "POST") return rpc(origin, "yai_add_person", { p_token: token, p_person: body });
    const pe = path.match(/^\/api\/people\/([^/]+)$/);
    if (pe && method === "POST") return rpc(origin, "yai_update_person", { p_token: token, p_code: decodeURIComponent(pe[1]), p_person: body });
    if (pe && method === "DELETE") return rpc(origin, "yai_remove_person", { p_token: token, p_code: decodeURIComponent(pe[1]) });
    const pp = path.match(/^\/api\/people\/([^/]+)\/nickname$/);
    if (pp && method === "POST") return rpc(origin, "yai_set_nickname", { p_token: token, p_code: decodeURIComponent(pp[1]), p_nickname: body.nickname ?? "" });
    if (path === "/api/scan" && method === "POST")
      return functionCall(origin, "scan-event", { token, images: body.images, today: body.today, languages: body.languages });
    if (path === "/api/people") return rpc(origin, "yai_people", { p_token: token });
    if (path === "/api/journal/events" && method === "GET") return rpc(origin, "yai_events", { p_token: token });
    if (path === "/api/journal/events" && method === "POST") return rpc(origin, "yai_add", { p_token: token, p_event: body });
    if (path === "/api/journal/import" && method === "POST")
      return rpc(origin, "yai_import", { p_token: token, p_events: Array.isArray(body) ? body : body.events });
    if (ev && method === "DELETE") return rpc(origin, "yai_delete", { p_token: token, p_id: +ev[1] });
    if (ev && ev[2]) return rpc(origin, "yai_done", { p_token: token, p_id: +ev[1], p_done: !!body.done });
    if (ev && method === "POST") return rpc(origin, "yai_update", { p_token: token, p_id: +ev[1], p_patch: body });
    // reminders: the "reminders" Edge Function (supabase/functions/reminders)
    if (path === "/api/push/key") return reminders(origin, { action: "key" });
    if (path === "/api/push/subscribe" && method === "POST")
      return reminders(origin, { action: "subscribe", token, subscription: body.subscription ?? body, test: !!body.test, lang: body.lang });
    if (path === "/api/push/unsubscribe" && method === "POST") return reminders(origin, { action: "unsubscribe", token, endpoint: body.endpoint });
    return reply({ detail: "not available on this backend" }, 404);
  }

  async function functionCall(origin, name, body) {
    const r = await real(`${origin}/functions/v1/${name}`, { method: "POST", headers: { "content-type": "application/json", apikey: await key() }, body: JSON.stringify(body) });
    return reply(await r.json().catch(() => ({ detail: r.statusText })), r.status);
  }

  async function reminders(origin, body) {
    const r = await real(`${origin}/functions/v1/reminders`, { method: "POST", headers: { "content-type": "application/json", apikey: await key() }, body: JSON.stringify(body) });
    // not deployed (yet): 404, and the app doesn't offer reminders
    return reply(await r.json().catch(() => ({ detail: r.statusText })), r.status);
  }

  window.fetch = async function (input, init) {
    let u;
    try { u = new URL(typeof input === "string" ? input : input.url, location.href); } catch (_) { return real(input, init); }
    if (!u.pathname.includes("/api/")) return real(input, init);
    const c = await conf();
    if (!c.key || u.origin !== c.origin || !u.pathname.startsWith("/api/")) return real(input, init);
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) {}
    return answer(u.origin, ((init && init.method) || "GET").toUpperCase(), u.pathname, body || {}, header(init && init.headers, "x-token").trim());
  };
})();
