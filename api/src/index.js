async function rolesForToken(env, token) {
  if (!token) return new Set();
  const value = await env.AUTH.get(token);
  if (!value) return new Set();
  return new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
}

async function loadPolicy(env) {
  const obj = await env.FILES.get(env.POLICY_KEY, { onlyIf: {} });
  if (!obj) return { directories: [] };
  try { return JSON.parse(await obj.text()); } catch { return { directories: [] }; }
}

function ruleForKey(policy, key) {
  let winner = null;
  for (const r of policy.directories) {
    if (key.startsWith(r.prefix)) {
      if (!winner || r.prefix.length > winner.prefix.length) winner = r;
    }
  }
  return winner;
}

async function canRead(env, policy, key, token) {
  const rule = ruleForKey(policy, key);
  if (!rule) return false;
  if (rule.read === "ANONYMOUS") return true;
  const roles = await rolesForToken(env, token);
  return rule.read.some((role) => roles.has(role));
}

async function canWrite(env, policy, key, token) {
  const rule = ruleForKey(policy, key);
  if (!rule) return false;
  const roles = await rolesForToken(env, token);
  return rule.write.some((role) => roles.has(role));
}

function getToken(req) {
  const h = req.headers.get("authorization") || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7) : h;
  if (bearer) return bearer.trim();
  const q = new URL(req.url).searchParams.get("key");
  return q ? q.trim() : "";
}

function cacheHeaders(maxAge) {
  return { "cache-control": `public, max-age=${maxAge}` };
}

async function streamObj(obj) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
  headers.set("etag", obj.etag);
  headers.set("cache-control", "public, max-age=3600");
  return new Response(obj.body, { headers });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function text(msg, status = 400) {
  return new Response(msg, { status });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, "");
    const token = getToken(req);
    const policy = await loadPolicy(env);

    if (path === "health") return text("ok", 200);

    if (req.method === "GET" && path === "ls") {
      const prefix = url.searchParams.get("prefix") || "";
      if (!prefix) return text("Missing prefix", 400);
      const allowed = await canRead(env, policy, prefix, token);
      if (!allowed) return text("Unauthorized", 401);
      const list = await env.FILES.list({ prefix, delimiter: "/" });
      return json({
        prefix,
        directories: list.delimitedPrefixes,
        objects: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded, etag: o.etag }))
      }, 200, cacheHeaders(parseInt(env.CACHE_SECONDS || "0", 10)));
    }

    if (req.method === "GET" && path.startsWith("pub/")) {
      const key = env.PUBLIC_PREFIX + path.slice(4);
      const can = await canRead(env, policy, key, token);
      if (!can) return text("Unauthorized", 401);
      const obj = await env.FILES.get(key);
      return obj ? streamObj(obj) : text("Not found", 404);
    }

    if (path.startsWith("priv/")) {
      const key = env.RESTRICTED_PREFIX + path.slice(5);
      if (req.method === "GET") {
        if (!(await canRead(env, policy, key, token))) return text("Unauthorized", 401);
        const obj = await env.FILES.get(key);
        return obj ? streamObj(obj) : text("Not found", 404);
      }
      if (req.method === "PUT") {
        if (!(await canWrite(env, policy, key, token))) return text("Unauthorized", 401);
        const put = await env.FILES.put(key, req.body, {
          httpMetadata: { contentType: req.headers.get("content-type") || undefined },
        });
        return json({ key: put.key, etag: put.etag }, 200);
      }
      if (req.method === "DELETE") {
        if (!(await canWrite(env, policy, key, token))) return text("Unauthorized", 401);
        await env.FILES.delete(key);
        return new Response(null, { status: 204 });
      }
      return text("Method not allowed", 405);
    }

    return text("Not found", 404);
  }
};
