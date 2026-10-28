// test/ingest.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// test/vendor/normalize.ts
var MAX_URL = 2048;
var MAX_TAGS = 20;
var MAX_TAG_LEN = 50;
var TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|igshid|ref_src)$/i;
function checkUrl(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "missing-url" };
  const s = raw.trim();
  if (!s) return { ok: false, reason: "missing-url" };
  if (s.length > MAX_URL) return { ok: false, reason: "url-too-long" };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "unsupported-scheme" };
  if (u.username || u.password) return { ok: false, reason: "credentials-in-url" };
  return { ok: true, url: s, key: urlKey(u) };
}
function urlKey(u) {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port && !(u.protocol === "http:" && u.port === "80" || u.protocol === "https:" && u.port === "443") ? ":" + u.port : "";
  const path = u.pathname.replace(/\/+$/, "") || "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const qs = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `${host}${port}${path}${qs}`;
}
function cleanText(v, max) {
  return (typeof v === "string" ? v : "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}
function normalizeTag(t) {
  return t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_\-./+]/gu, "").slice(0, MAX_TAG_LEN);
}
function normalizeTags(list) {
  const out = /* @__PURE__ */ new Set();
  for (const t of list) {
    const n = normalizeTag(t);
    if (n) out.add(n);
    if (out.size >= MAX_TAGS) break;
  }
  return [...out];
}

// web/ingest.ts
var MAX_BODY = 64 * 1024;
var KIND_TAG = { page: null, selection: "note", image: "image" };
function parseIngest(text) {
  if (text.length > MAX_BODY) return { ok: false };
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!j || typeof j !== "object" || !["page", "selection", "image"].includes(j.kind)) return { ok: false };
  const u = checkUrl(j.url);
  if (!u.ok) return { ok: false };
  let imageUrl = null;
  if (j.kind === "image") {
    const i = checkUrl(j.imageUrl);
    if (!i.ok) return { ok: false };
    imageUrl = i.url;
  }
  let faviconUrl = null;
  if (typeof j.favicon === "string" && j.favicon.length <= 2048) {
    const f = checkUrl(j.favicon);
    if (f.ok) faviconUrl = f.url;
  }
  const description = cleanText(j.description, 300) || null;
  return { ok: true, value: {
    kind: j.kind,
    url: u.url,
    urlKey: u.key,
    title: cleanText(j.title, 500),
    note: cleanText(j.note, 1e4) || null,
    tags: normalizeTags(Array.isArray(j.tags) ? j.tags.filter((t) => typeof t === "string") : []),
    imageUrl,
    faviconUrl,
    description
  } };
}
function mergeNote(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.includes(incoming)) return existing;
  return `${existing}

${incoming}`.slice(0, 1e4);
}
var bearer = (h) => /^Bearer\s+(\S{20,4096})$/i.exec(h ?? "")?.[1] ?? null;
async function handleIngest(d, authorization, method, bodyText = "") {
  const jwt = bearer(authorization);
  const user = jwt ? await d.getUser(jwt).catch(() => null) : null;
  if (!user) return { status: 401, body: { code: "invalid_token" } };
  if (method === "GET") return { status: 200, body: { user: { id: user.id, email: user.email } } };
  const p = parseIngest(bodyText);
  if (!p.ok) return { status: 400, body: { code: "bad_input" } };
  const b = p.value, extra = KIND_TAG[b.kind];
  const tags = normalizeTags([...b.tags, ...extra ? [extra] : []]);
  const existing = await d.find(user.id, b.urlKey);
  if (!existing) {
    const id = await d.insert({ user_id: user.id, url: b.url, url_key: b.urlKey, title: b.title || new URL(b.url).hostname, note: b.note, tags, source: `extension:${b.kind}`, favicon_url: b.faviconUrl, meta_description: b.description });
    return { status: 201, body: { id, created: true, kind: b.kind } };
  }
  const note = mergeNote(existing.note, b.note), merged = normalizeTags([...existing.tags, ...tags]);
  if (note !== existing.note || merged.length !== existing.tags.length) await d.update(existing.id, { note, tags: merged });
  return { status: 200, body: { id: existing.id, created: false, kind: b.kind } };
}

// test/ingest.test.ts
var JWT = "h".repeat(10) + "." + "p".repeat(40) + "." + "s".repeat(10);
function deps(o = {}) {
  const rows = o.rows ?? /* @__PURE__ */ new Map();
  const calls = [];
  const d = {
    getUser: async (t) => {
      calls.push("getUser");
      return t === JWT ? o.user === void 0 ? { id: "u1", email: "a@x.com" } : o.user : null;
    },
    find: async (uid, key) => {
      calls.push(`find:${uid}:${key}`);
      return rows.get(`${uid}|${key}`) ?? null;
    },
    insert: async (row) => {
      const id = `id${rows.size + 1}`;
      rows.set(`${row.user_id}|${row.url_key}`, { id, note: row.note, tags: row.tags, urlKey: row.url_key });
      calls.push(`insert:${row.source}`);
      return id;
    },
    update: async (id, p) => {
      calls.push("update");
      for (const r of rows.values()) if (r.id === id) Object.assign(r, p);
    }
  };
  return { d, rows, calls };
}
var post = (d, body, auth = `Bearer ${JWT}`) => handleIngest(d, auth, "POST", JSON.stringify(body));
test("GET verifies a token and returns the user; bad/missing tokens are 401 and touch nothing else", async () => {
  const { d, calls } = deps();
  assert.deepEqual(await handleIngest(d, `Bearer ${JWT}`, "GET"), { status: 200, body: { user: { id: "u1", email: "a@x.com" } } });
  for (const auth of [null, "", "Bearer", `Token ${JWT}`, "Bearer short", `Bearer ${JWT}x`]) assert.equal((await handleIngest(d, auth, "GET")).status, 401, String(auth));
  assert.ok(!calls.some((c) => c.startsWith("find") || c.startsWith("insert")));
});
test("page save inserts once, with the owner from the VERIFIED token, never from the body", async () => {
  const { d, rows, calls } = deps();
  const r = await post(d, { kind: "page", url: "https://a.com/x?utm_source=z#f", title: "T", user_id: "attacker", tags: ["AI"] });
  assert.deepEqual([r.status, r.body.created], [201, true]);
  assert.ok(rows.has("u1|a.com/x") && !JSON.stringify([...rows.keys()]).includes("attacker"));
  assert.ok(calls.includes("insert:extension:page"));
  const again = await post(d, { kind: "page", url: "https://www.a.com/x", title: "T" });
  assert.deepEqual([again.status, again.body.created, rows.size], [200, false, 1]);
});
test("selection becomes a note on the page; a replay does not duplicate it; a second selection appends", async () => {
  const { d, rows } = deps();
  await post(d, { kind: "page", url: "https://a.com/x", title: "T" });
  await post(d, { kind: "selection", url: "https://a.com/x", note: "> one" });
  await post(d, { kind: "selection", url: "https://a.com/x", note: "> one" });
  await post(d, { kind: "selection", url: "https://a.com/x", note: "> two" });
  const row = rows.get("u1|a.com/x");
  assert.equal(row.note, "> one\n\n> two");
  assert.deepEqual(row.tags, ["note"]);
});
test("image: needs an http(s) image URL, is tagged, and says nothing about OCR", async () => {
  const { d, rows } = deps();
  const r = await post(d, { kind: "image", url: "https://a.com/p", imageUrl: "https://c.test/i.png", note: "![image](https://c.test/i.png)" });
  assert.equal(r.status, 201);
  assert.deepEqual(rows.get("u1|a.com/p").tags, ["image"]);
  assert.ok(!("ocr" in r.body));
  for (const imageUrl of [void 0, "data:image/png;base64,AA", "javascript:alert(1)"]) assert.equal((await post(d, { kind: "image", url: "https://a.com/q", imageUrl })).status, 400);
});
test("bad input is 400: unknown kind, unsafe url, junk, oversized body", async () => {
  const { d } = deps();
  for (const b of [{ kind: "x", url: "https://a.com" }, { kind: "page", url: "javascript:alert(1)" }, { kind: "page", url: "ftp://a.com" }, { kind: "page" }, null])
    assert.equal((await post(d, b)).status, 400, JSON.stringify(b));
  assert.equal((await handleIngest(d, `Bearer ${JWT}`, "POST", "{not json")).status, 400);
  assert.equal((await handleIngest(d, `Bearer ${JWT}`, "POST", JSON.stringify({ kind: "page", url: "https://a.com", note: "x".repeat(7e4) }))).status, 400);
});
test("parseIngest clamps lengths and cleans tags", () => {
  const p = parseIngest(JSON.stringify({ kind: "page", url: "https://a.com", title: "T".repeat(900), note: "n".repeat(2e4), tags: ["#Big Data", 5, "big-data"] }));
  assert.ok(p.ok && p.value.title.length === 500 && p.value.note.length === 1e4 && p.value.tags.join() === "big-data");
  assert.equal(mergeNote(null, "a"), "a");
  assert.equal(mergeNote("a", null), "a");
});
test("favicon and description are stored only when safe (http/https favicon; description trimmed to 300)", async () => {
  let row = {};
  const { d } = deps();
  const d2 = { ...d, insert: async (r) => {
    row = r;
    return "id1";
  } };
  await post(d2, { kind: "page", url: "https://a.com/z", title: "T", favicon: "https://a.com/f.ico", description: "d".repeat(500) });
  assert.equal(row.favicon_url, "https://a.com/f.ico");
  assert.equal(row.meta_description.length, 300);
  await post(d2, { kind: "page", url: "https://a.com/y", title: "T", favicon: "javascript:alert(1)" });
  assert.equal(row.favicon_url, null);
  assert.equal(row.meta_description, null);
});
