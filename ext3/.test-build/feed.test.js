// test/feed.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/lib/feed.ts
var UNCATEGORIZED = "Uncategorized";
var ALL = "All";
var isHttp = (u) => {
  if (typeof u !== "string") return false;
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};
var hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
};
var str = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
function parseFeedRows(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const r of json) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !isHttp(r.url)) continue;
    out.push({
      id: r.id,
      url: r.url,
      title: str(r.title, 300) || hostOf(r.url),
      favicon_url: isHttp(r.favicon_url) ? r.favicon_url : null,
      ai_category: str(r.ai_category, 60) || null,
      summary_tldr: str(r.summary_tldr, 600) || null,
      created_at: typeof r.created_at === "string" && !Number.isNaN(Date.parse(r.created_at)) ? r.created_at : (/* @__PURE__ */ new Date(0)).toISOString()
    });
  }
  return out;
}
function groupByCategory(items) {
  const map = items.reduce((m, it) => {
    const k = it.ai_category ?? UNCATEGORIZED;
    (m.get(k) ?? m.set(k, []).get(k)).push(it);
    return m;
  }, /* @__PURE__ */ new Map());
  return [...map].map(([name, list]) => ({ name, items: list })).sort((a, b) => a.name === UNCATEGORIZED ? 1 : b.name === UNCATEGORIZED ? -1 : b.items.length - a.items.length || a.name.localeCompare(b.name));
}
function filterFeed(items, query, category) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (category !== ALL && (it.ai_category ?? UNCATEGORIZED) !== category) return false;
    if (!terms.length) return true;
    const hay = `${it.title} ${hostOf(it.url)} ${it.summary_tldr ?? ""} ${it.ai_category ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1e3);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: now - Date.parse(iso) > 86400 * 33e4 ? "numeric" : void 0 });
}

// src/shared/config.ts
var WEB_ORIGINS = typeof __WEB_ORIGINS__ !== "undefined" ? __WEB_ORIGINS__ : ["https://www.bukmarkz.com", "https://bukmarkz.com"];
var API_BASE = (typeof __API_BASE__ !== "undefined" ? __API_BASE__ : WEB_ORIGINS[0]).replace(/\/+$/, "");
var SUPABASE_URL = (typeof __SUPABASE_URL__ !== "undefined" ? __SUPABASE_URL__ : "https://YOUR_PROJECT.supabase.co").replace(/\/+$/, "");
var SIGN_IN_URL = `${WEB_ORIGINS[0]}/login?source=extension`;
var DASHBOARD_URL = `${WEB_ORIGINS[0]}/`;
var LIMITS = {
  recentSaves: 8,
  note: 2e3,
  richNote: 1e4,
  imageUrl: 2048,
  tag: 24,
  tags: 8,
  title: 100,
  description: 300,
  faviconUrl: 2048,
  bridgePayloadBytes: 8192,
  reminderMaxDays: 365
};

// src/shared/validate.ts
function isSavableUrl(raw) {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_eid$|ref_src$)/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}
function cleanTag(raw) {
  return raw.trim().toLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/\s+/g, "-").slice(0, LIMITS.tag);
}
function cleanTags(tags) {
  const out = [];
  for (const t of tags) {
    const c = cleanTag(t);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}
var KINDS = ["page", "selection", "image"];
function sanitizeSave(input) {
  if (!input || typeof input !== "object") return null;
  const i = input;
  if (typeof i.url !== "string" || !isSavableUrl(i.url)) return null;
  const kind = KINDS.includes(i.kind) ? i.kind : "page";
  let imageUrl;
  if (kind === "image") {
    if (typeof i.imageUrl !== "string" || !isSavableUrl(i.imageUrl) || i.imageUrl.length > LIMITS.imageUrl) return null;
    imageUrl = i.imageUrl;
  }
  const favicon = typeof i.favicon === "string" && i.favicon.length <= LIMITS.faviconUrl && isSavableUrl(i.favicon) ? i.favicon : void 0;
  const description = typeof i.description === "string" ? i.description.replace(/\s+/g, " ").trim().slice(0, LIMITS.description) : "";
  const remind = typeof i.remindAt === "number" && Number.isFinite(i.remindAt) ? i.remindAt : null;
  const maxAt = Date.now() + LIMITS.reminderMaxDays * 864e5;
  return {
    url: normalizeUrl(i.url),
    title: String(i.title ?? "").trim().slice(0, LIMITS.title),
    note: String(i.note ?? "").slice(0, kind === "page" ? LIMITS.note : LIMITS.richNote),
    tags: cleanTags(Array.isArray(i.tags) ? i.tags.map(String) : []),
    remindAt: remind !== null && remind > Date.now() && remind <= maxAt ? remind : null,
    private: i.private === true,
    kind,
    ...imageUrl ? { imageUrl } : {},
    ...favicon ? { favicon } : {},
    ...description ? { description } : {}
  };
}

// test/feed.test.ts
var row = (o = {}) => ({ id: "a", title: "T", url: "https://x.com/p", favicon_url: "https://x.com/f.ico", ai_category: "AI & ML", summary_tldr: "sum", created_at: "2026-10-20T10:00:00Z", ...o });
test("parseFeedRows keeps good rows and drops hostile / malformed ones", () => {
  const out = parseFeedRows([row(), row({ id: "b", url: "javascript:alert(1)" }), row({ id: "c", favicon_url: "data:image/png;base64,AAAA" }), { id: 5 }, null, row({ id: "d", title: "", ai_category: "  " })]);
  assert.deepEqual(out.map((r) => r.id), ["a", "c", "d"]);
  assert.equal(out[1].favicon_url, null);
  assert.equal(out[2].title, "x.com");
  assert.equal(out[2].ai_category, null);
  assert.deepEqual(parseFeedRows({ not: "an array" }), []);
});
test("groupByCategory: biggest first, Uncategorized last, no mutation of input order inside groups", () => {
  const items = parseFeedRows([row({ id: "1", ai_category: "Finance" }), row({ id: "2", ai_category: null }), row({ id: "3", ai_category: "Development" }), row({ id: "4", ai_category: "Development" }), row({ id: "5", ai_category: "Finance" }), row({ id: "6", ai_category: "Reading List" })]);
  const g = groupByCategory(items);
  assert.deepEqual(g.map((x) => x.name), ["Development", "Finance", "Reading List", UNCATEGORIZED]);
  assert.deepEqual(g[0].items.map((i) => i.id), ["3", "4"]);
});
test("filterFeed: category tab + every search term must match title, host, summary or category", () => {
  const items = parseFeedRows([row({ id: "1", title: "Postgres RLS guide", ai_category: "Development", summary_tldr: "row level security" }), row({ id: "2", title: "Index funds", ai_category: "Finance", url: "https://invest.com/a" }), row({ id: "3", title: "Loose note", ai_category: null })]);
  assert.deepEqual(filterFeed(items, "", ALL).length, 3);
  assert.deepEqual(filterFeed(items, "security rls", ALL).map((i) => i.id), ["1"]);
  assert.deepEqual(filterFeed(items, "invest", ALL).map((i) => i.id), ["2"]);
  assert.deepEqual(filterFeed(items, "", UNCATEGORIZED).map((i) => i.id), ["3"]);
  assert.deepEqual(filterFeed(items, "rls", "Finance"), []);
});
test("timeAgo", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  assert.deepEqual(["2026-10-21T11:59:40Z", "2026-10-21T11:15:00Z", "2026-10-21T07:00:00Z", "2026-10-18T12:00:00Z"].map((d) => timeAgo(d, now)), ["just now", "45m ago", "5h ago", "3d ago"]);
});
test("sanitizeSave carries favicon (http/https only) and a trimmed description", () => {
  const base = { url: "https://a.com/x", title: "T", note: "", tags: [], remindAt: null, private: false };
  const ok = sanitizeSave({ ...base, favicon: "https://a.com/f.png", description: "  hello \n world " });
  assert.deepEqual([ok.favicon, ok.description], ["https://a.com/f.png", "hello world"]);
  const bad = sanitizeSave({ ...base, favicon: "data:image/svg+xml,<svg onload=x>", description: "x".repeat(1e3) });
  assert.equal(bad.favicon, void 0);
  assert.equal(bad.description.length, 300);
});
