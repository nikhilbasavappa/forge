/* Forge sync + buddy accountability — Cloudflare Worker.
 * /state : one JSON blob per passphrase (personal sync).
 * /group : buddy group keyed by a shared code; one summary + push sub per member.
 * /poke, /pending : buddy web-push notifications (payloadless VAPID; SW fetches text).
 */

const ALLOWED_ORIGINS = [
  "https://nikhilbasavappa.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

// VAPID public key (safe to expose). Private key is env.VAPID_PRIVATE (a secret JWK).
const VAPID_PUBLIC = "BJLYgTutp5l4DiFz00NSF0kAnlj5Q9zL5_1tdkLCJJvlGcTaaNZGkvWRbGjtfO8t4memHTeM907mrIa0rteN4Bk";
const VAPID_SUBJECT = "mailto:nb2993@columbia.edu";

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Group",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(obj, status, h) {
  return new Response(JSON.stringify(obj), { status, headers: { ...h, "Content-Type": "application/json" } });
}

/* ---- web push (payloadless, VAPID only) ---- */
function b64url(bytes) {
  let s = ""; const u = new Uint8Array(bytes);
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strB64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function vapidHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = strB64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = strB64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: VAPID_SUBJECT }));
  const data = header + "." + payload;
  const jwk = JSON.parse(env.VAPID_PRIVATE);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data));
  return `vapid t=${data}.${b64url(sig)}, k=${VAPID_PUBLIC}`;
}
async function sendPush(sub, env) {
  try {
    const auth = await vapidHeader(sub.endpoint, env);
    const res = await fetch(sub.endpoint, { method: "POST", headers: { Authorization: auth, TTL: "2419200" } });
    return res.status;
  } catch (e) { return 0; }
}
async function notify(env, group, toName, members, msg) {
  const target = members[toName];
  if (!target) return;
  const pkey = `pending:${group}:${toName}`;
  const cur = await env.FORGE_KV.get(pkey);
  const arr = cur ? JSON.parse(cur) : [];
  arr.push(msg);
  await env.FORGE_KV.put(pkey, JSON.stringify(arr.slice(-10)));
  if (target.sub) await sendPush(target.sub, env);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const h = corsHeaders(origin);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);

    // ---- buddy group ----
    if (url.pathname === "/group") {
      const group = (req.headers.get("X-Group") || url.searchParams.get("group") || "").trim();
      if (group.length < 6) return json({ error: "group code must be 6+ characters" }, 401, h);
      const gkey = "group:" + group;
      if (req.method === "GET") {
        const v = await env.FORGE_KV.get(gkey);
        const members = v ? JSON.parse(v) : {};
        const out = {};
        for (const [n, m] of Object.entries(members)) out[n] = { summary: m.summary, at: m.at }; // strip subs
        return json({ members: out }, 200, h);
      }
      if (req.method === "PUT") {
        let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
        const name = String(body.name || "anon").slice(0, 40);
        const cur = await env.FORGE_KV.get(gkey);
        const members = cur ? JSON.parse(cur) : {};
        const old = members[name];
        const oldTotal = old && old.summary ? (old.summary.totalWorkouts || 0) : null;
        members[name] = { summary: body.summary || {}, at: Date.now(), sub: body.sub || (old && old.sub) || null };
        await env.FORGE_KV.put(gkey, JSON.stringify(members));
        const newTotal = (body.summary && body.summary.totalWorkouts) || 0;
        if (oldTotal != null && newTotal > oldTotal) {
          const wk = body.summary.weekSessions, wt = body.summary.weekTarget;
          for (const other of Object.keys(members)) {
            if (other !== name) await notify(env, group, other, members, `${name} just trained — ${wk}/${wt} this week`);
          }
        }
        return json({ ok: true }, 200, h);
      }
      return json({ error: "method not allowed" }, 405, h);
    }

    if (url.pathname === "/poke" && req.method === "PUT") {
      let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
      const group = String(body.group || "").trim();
      if (group.length < 6) return json({ error: "bad group" }, 401, h);
      const cur = await env.FORGE_KV.get("group:" + group);
      const members = cur ? JSON.parse(cur) : {};
      await notify(env, group, String(body.to || ""), members, `${String(body.from || "Your buddy")} poked you — get moving`);
      return json({ ok: true }, 200, h);
    }

    if (url.pathname === "/pending" && req.method === "GET") {
      const group = (url.searchParams.get("group") || "").trim();
      const name = url.searchParams.get("name") || "";
      if (group.length < 6) return json({ messages: [] }, 200, h);
      const pkey = `pending:${group}:${name}`;
      const cur = await env.FORGE_KV.get(pkey);
      if (cur) await env.FORGE_KV.delete(pkey);
      return json({ messages: cur ? JSON.parse(cur) : [] }, 200, h);
    }

    // ---- personal sync ----
    if (url.pathname !== "/state") return new Response("Forge sync OK", { status: 200, headers: h });
    const key = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (key.length < 8) return json({ error: "passphrase must be 8+ characters" }, 401, h);
    const kvKey = "state:" + key;
    if (req.method === "GET") {
      const v = await env.FORGE_KV.get(kvKey);
      return json({ state: v ? JSON.parse(v) : null }, 200, h);
    }
    if (req.method === "PUT") {
      let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
      await env.FORGE_KV.put(kvKey, JSON.stringify(body.state ?? {}));
      return json({ ok: true, savedAt: Date.now() }, 200, h);
    }
    return json({ error: "method not allowed" }, 405, h);
  },
};
