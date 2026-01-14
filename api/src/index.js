function corsHeaders(req) {
  const h = new Headers();
  h.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  h.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

function withCors(req, res) {
  const h = corsHeaders(req);
  for (const [k, v] of h) res.headers.set(k, v);
  return res;
}

async function rolesForToken(env, token) {
  if (!token) return new Set();
  const value = await env.AUTH.get(token);
  if (!value) return new Set();
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
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

function isAnonymousRead(readField) {
  return typeof readField === 'string' && readField.toLowerCase() === 'anonymous';
}

async function canRead(env, policy, key, token) {
  const rule = ruleForKey(policy, key);
  if (!rule) return false;
  if (isAnonymousRead(rule.read)) return true;
  const roles = await rolesForToken(env, token);
  const canByRead  = Array.isArray(rule.read)  && rule.read.some((r) => roles.has(r));
  const canByWrite = Array.isArray(rule.write) && rule.write.some((r) => roles.has(r));
  return canByRead || canByWrite;
}

async function canWrite(env, policy, key, token) {
  const rule = ruleForKey(policy, key);
  if (!rule) return false;
  const roles = await rolesForToken(env, token);
  return Array.isArray(rule.write) && rule.write.some((role) => roles.has(role));
}

function getToken(req) {
  const h = req.headers.get('authorization') || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : h;
  if (bearer) return bearer.trim();
  const q = new URL(req.url).searchParams.get('key');
  return q ? q.trim() : '';
}

function cacheHeaders(maxAge) {
  return { 'cache-control': `public, max-age=${maxAge}` };
}

async function streamObj(obj) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  headers.set('etag', obj.etag);
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}

function metaResponseFromR2(obj) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  headers.set('etag', obj.etag);
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('content-length', String(obj.size));
  return new Response(null, { status: 200, headers });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function text(msg, status = 400) {
  return new Response(msg, { status });
}

// ---- prefix helpers ----
function visiblePrefixesFor(policy, rolesSet) {
  const has = (arr) => Array.isArray(arr) && arr.some(r => rolesSet.has(r));
  const out = [];
  for (const dir of policy.directories || []) {
    const canRead = isAnonymousRead(dir.read) || has(dir.read) || has(dir.write);
    if (canRead) out.push(dir.prefix.endsWith('/') ? dir.prefix : dir.prefix + '/');
  }
  return [...new Set(out)].sort((a,b)=>a.localeCompare(b));
}

function writablePrefixesFor(policy, rolesSet) {
  const has = (arr) => Array.isArray(arr) && arr.some(r => rolesSet.has(r));
  const out = [];
  for (const dir of policy.directories || []) {
    if (has(dir.write)) out.push(dir.prefix.endsWith('/') ? dir.prefix : dir.prefix + '/');
  }
  return [...new Set(out)].sort((a,b)=>a.localeCompare(b));
}

// ---- recursive list (no delimiter) ----
async function listAllObjects(env, prefix) {
  const out = [];
  let cursor = undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor }); // recursive
    for (const o of page.objects) {
      out.push({ key: o.key, size: o.size, uploaded: o.uploaded, etag: o.etag });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export default {
  async fetch(req, env) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return withCors(req, new Response(null, { status: 204 }));
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, '');
    const token = getToken(req);
    const policy = await loadPolicy(env);

    // healthz
    if (path === 'healthz') return withCors(req, text('OK', 200));

    // auth
    if (req.method === 'GET' && path === 'auth/verify') {
      const roles = await rolesForToken(env, token);
      if (!roles.size) return withCors(req, text('Unauthorized', 401));
      const prefixes = visiblePrefixesFor(policy, roles);
      const writePrefixes = writablePrefixesFor(policy, roles);
      return withCors(req, json({ roles: [...roles], prefixes, writePrefixes }, 200));
    }

    // list (recursive)
    if (req.method === 'GET' && path === 'ls') {
      let prefix = url.searchParams.get('prefix') || '';
      if (!prefix) return withCors(req, text('Missing prefix', 400));
      if (!prefix.endsWith('/')) prefix += '/'; // normalize
      const allowed = await canRead(env, policy, prefix, token);
      if (!allowed) return withCors(req, text('Unauthorized', 401));
      const objects = await listAllObjects(env, prefix);
      return withCors(req, json({ prefix, objects }, 200));
    }

    // pub/*
    if (path.startsWith('pub/')) {
      const raw = path.slice(4);
      let rel; try { rel = decodeURIComponent(raw); } catch { rel = raw; }
      const key = env.PUBLIC_PREFIX + rel;

      if (req.method === 'HEAD') {
        const can = await canRead(env, policy, key, token);
        if (!can) return withCors(req, text('Unauthorized', 401));
        const obj = await env.FILES.head(key);
        return withCors(req, obj ? metaResponseFromR2(obj) : text('Not found', 404));
      }

      if (req.method === 'GET') {
        const can = await canRead(env, policy, key, token);
        if (!can) return withCors(req, text('Unauthorized', 401));
        const obj = await env.FILES.get(key);
        return withCors(req, obj ? await streamObj(obj) : text('Not found', 404));
      }

      if (req.method === 'PUT') {
        if (!(await canWrite(env, policy, key, token))) return withCors(req, text('Unauthorized', 401));
        const put = await env.FILES.put(key, req.body, {
          httpMetadata: { contentType: req.headers.get('content-type') || undefined },
        });
        return withCors(req, json({ key: put.key, etag: put.etag }, 200));
      }

      if (req.method === 'DELETE') {
        if (!(await canWrite(env, policy, key, token))) return withCors(req, text('Unauthorized', 401));
        await env.FILES.delete(key);
        return withCors(req, new Response(null, { status: 204 }));
      }

      return withCors(req, text('Method not allowed', 405));
    }

    // priv/*
    if (path.startsWith('priv/')) {
      const raw = path.slice(5);
      let rel; try { rel = decodeURIComponent(raw); } catch { rel = raw; }
      const key = env.RESTRICTED_PREFIX + rel;

      if (req.method === 'HEAD') {
        if (!(await canRead(env, policy, key, token))) return withCors(req, text('Unauthorized', 401));
        const obj = await env.FILES.head(key);
        return withCors(req, obj ? metaResponseFromR2(obj) : text('Not found', 404));
      }

      if (req.method === 'GET') {
        if (!(await canRead(env, policy, key, token))) return withCors(req, text('Unauthorized', 401));
        const obj = await env.FILES.get(key);
        return withCors(req, obj ? await streamObj(obj) : text('Not found', 404));
      }

      if (req.method === 'PUT') {
        if (!(await canWrite(env, policy, key, token))) return withCors(req, text('Unauthorized', 401));
        const put = await env.FILES.put(key, req.body, {
          httpMetadata: { contentType: req.headers.get('content-type') || undefined },
        });
        return withCors(req, json({ key: put.key, etag: put.etag }, 200));
      }

      if (req.method === 'DELETE') {
        if (!(await canWrite(env, policy, key, token))) return withCors(req, text('Unauthorized', 401));
        await env.FILES.delete(key);
        return withCors(req, new Response(null, { status: 204 }));
      }

      return withCors(req, text('Method not allowed', 405));
    }

    return withCors(req, text('Not found', 404));
  },
};
