/* Forge sync — a tiny Cloudflare Worker.
 * Stores one JSON state blob per passphrase in KV. The passphrase is the shared
 * secret: anyone who knows it can read/write that blob, so it must be long.
 * No accounts, no login UI. The client does all merge logic; this just GET/PUTs.
 */

const ALLOWED_ORIGINS = [
  "https://nikhilbasavappa.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Group",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, h) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...h, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const h = corsHeaders(origin);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);

    // Buddy accountability group: a shared group code, one summary per member name.
    if (url.pathname === "/group") {
      const group = (req.headers.get("X-Group") || url.searchParams.get("group") || "").trim();
      if (group.length < 6) return json({ error: "group code must be 6+ characters" }, 401, h);
      const gkey = "group:" + group;
      if (req.method === "GET") {
        const v = await env.FORGE_KV.get(gkey);
        return json({ members: v ? JSON.parse(v) : {} }, 200, h);
      }
      if (req.method === "PUT") {
        let body;
        try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
        const name = String(body.name || "anon").slice(0, 40);
        const cur = await env.FORGE_KV.get(gkey);
        const members = cur ? JSON.parse(cur) : {};
        members[name] = { summary: body.summary || {}, at: Date.now() };
        await env.FORGE_KV.put(gkey, JSON.stringify(members));
        return json({ ok: true }, 200, h);
      }
      return json({ error: "method not allowed" }, 405, h);
    }

    if (url.pathname !== "/state") {
      return new Response("Forge sync OK", { status: 200, headers: h });
    }

    const key = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (key.length < 8) return json({ error: "passphrase must be 8+ characters" }, 401, h);
    const kvKey = "state:" + key;

    if (req.method === "GET") {
      const v = await env.FORGE_KV.get(kvKey);
      return json({ state: v ? JSON.parse(v) : null }, 200, h);
    }

    if (req.method === "PUT") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
      await env.FORGE_KV.put(kvKey, JSON.stringify(body.state ?? {}));
      return json({ ok: true, savedAt: Date.now() }, 200, h);
    }

    return json({ error: "method not allowed" }, 405, h);
  },
};
