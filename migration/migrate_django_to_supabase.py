#!/usr/bin/env python3
"""
Migrate Bukmarkz from Django/Knox to Supabase.  Dry-run by default; nothing is written without --execute.

  Users      -> Supabase Auth (Admin API, never direct SQL on auth.users)
  Categories -> collections (folders) and a tag, Bookmarks -> oneclist_items

Run from the Django project root so the ORM can be used:
    DJANGO_SETTINGS_MODULE=bukmarkz.settings python migrate_django_to_supabase.py [--execute] [--email a@b.c] [--limit N] [--verify]
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service-role key: keep it out of shell history and logs)

Safe to re-run: user ids are deterministic (uuid5 of the Django id) and bookmarks carry their Django id.

PASSWORDS ARE NOT MIGRATED. Django stores PBKDF2 hashes; Supabase imports only bcrypt/argon2 hashes. Users sign in with a magic
link / password reset, or via the legacy-token exchange described in README_MIGRATION.md.
"""
from __future__ import annotations

import argparse, csv, json, os, re, sys, time, uuid
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator
from urllib.parse import parse_qsl, urlsplit

import requests

# Fixed namespace. The Next.js exchange route derives the SAME ids from it (lib/legacy/ids.ts). Never change it.
NAMESPACE = uuid.UUID("b6dfa928-e339-45fd-9965-428a1b73993b")
EXPECTED_EMBED_MODEL = os.environ.get("EXPECTED_EMBED_MODEL", "text-embedding-3-small")  # must match the 1536-d column
BATCH = 500

def legacy_user_uuid(django_id: int) -> str:
    return str(uuid.uuid5(NAMESPACE, f"bukmarkz-legacy-user-{int(django_id)}"))

# ───────────── transforms (pure functions, unit-tested) ─────────────
_TRACKING = re.compile(r"^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|igshid|ref_src)$", re.I)

def check_url(raw: Any) -> tuple[str, str] | str:
    """Returns (url, url_key) or a skip-reason string. Mirrors lib/import/normalize.ts so keys match the importer's."""
    if not isinstance(raw, str) or not raw.strip(): return "missing-url"
    s = raw.strip()
    if len(s) > 2048: return "url-too-long"
    try:
        u = urlsplit(s); host = (u.hostname or "").lower(); port = u.port
    except ValueError:
        return "invalid-url"
    if u.scheme.lower() not in ("http", "https") or not host: return "unsupported-scheme" if host or u.scheme else "invalid-url"
    if u.username or u.password: return "credentials-in-url"
    host = re.sub(r"^www\.", "", host)
    default = (u.scheme.lower() == "http" and port == 80) or (u.scheme.lower() == "https" and port == 443)
    portpart = f":{port}" if port and not default else ""
    path = re.sub(r"/+$", "", u.path)
    q = sorted(((k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not _TRACKING.match(k)))
    qs = "?" + "&".join(f"{k}={v}" for k, v in q) if q else ""
    return s, f"{host}{portpart}{path}{qs}"

def tag(s: str) -> str:
    s = re.sub(r"^#+", "", str(s).strip().lower())
    s = re.sub(r"\s+", "-", s)
    return re.sub(r"[^\w\-./+]", "", s, flags=re.UNICODE)[:50].strip("-")

def uniq(xs: Iterable[str], cap: int = 20) -> list[str]:
    out: list[str] = []
    for x in xs:
        if x and x not in out: out.append(x)
    return out[:cap]

def clean(s: Any, n: int) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s if isinstance(s, str) else "").strip()[:n]

def transform_user(u: dict) -> dict | str:
    email = clean(u.get("email"), 254).lower()
    if not email or "@" not in email: return "no-email"
    if not u.get("is_active", True): return "inactive"
    name = clean(f"{u.get('first_name') or ''} {u.get('last_name') or ''}", 150) or clean(u.get("username"), 150)
    return {
        "id": legacy_user_uuid(u["id"]), "email": email,
        # Only assert a confirmed email if Django already proved it. Others confirm on first magic-link sign-in.
        "email_confirm": bool(u.get("email_verified")),
        "user_metadata": {"name": name},
        # app_metadata is server-writable only (user_metadata is editable by the user, so never trust it for entitlements)
        "app_metadata": {"legacy_user_id": u["id"], "is_subscribed": bool(u.get("is_subscribed")), "migrated_from": "django"},
    }

def transform_bookmark(b: dict, folder_tags: bool = True) -> dict | str:
    c = check_url(b.get("url"))
    if isinstance(c, str): return c
    url, key = c
    folder = clean(b.get("category_title"), 100)
    private = bool(b.get("category_private"))
    own = b.get("tags") if isinstance(b.get("tags"), list) else []
    emb = b.get("embedding")
    if emb is not None and not private and b.get("embedding_model") == EXPECTED_EMBED_MODEL and len(emb) == 1536:
        emb = "[" + ",".join(repr(float(x)) for x in emb) + "]"       # pgvector text format
    else:
        emb = None                                                     # re-embedded later; private rows are never embedded
    ts = b.get("timestamp")
    return {
        "legacy_id": b["id"], "url": url, "url_key": key, "title": clean(b.get("name"), 500) or url,
        "note": clean(b.get("description"), 10_000) or None,
        "tags": uniq(tag(t) for t in own if isinstance(t, str)),
        # Django categories are FLAT (there is no Folder model and no nesting), so the "path" is one level.
        "folder": [folder] if folder else [],
        "ai_tags": [tag(folder)] if folder_tags and tag(folder) else [],
        "is_private": private, "created_at": ts.isoformat() if hasattr(ts, "isoformat") else None, "embedding": emb,
    }

# ───────────── Supabase REST client ─────────────
class Supabase:
    def __init__(self, url: str, key: str, session: requests.Session | None = None):
        self.url = url.rstrip("/"); self.s = session or requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def _req(self, method: str, path: str, **kw) -> requests.Response:
        for attempt in range(5):
            r = self.s.request(method, self.url + path, timeout=60, **kw)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(min(30, (2 ** attempt) * 0.5 if os.environ.get("MIGRATE_FAST") is None else 0.01)); continue
            return r
        return r

    def create_user(self, u: dict) -> str:
        """'created' | 'exists' | 'conflict' (email already used by a DIFFERENT account) | 'error:<status>'"""
        r = self._req("POST", "/auth/v1/admin/users", json=u)
        if r.status_code in (200, 201): return "created"
        g = self._req("GET", f"/auth/v1/admin/users/{u['id']}")
        if g.status_code == 200: return "exists"                       # already migrated (same deterministic id)
        if r.status_code == 422: return "conflict"                     # email_exists, but not our id
        return f"error:{r.status_code}"

    def migrate_batch(self, user_id: str, items: list[dict]) -> tuple[int, int]:
        r = self._req("POST", "/rest/v1/rpc/migrate_legacy_batch", json={"p_user": user_id, "p_items": items})
        if r.status_code != 200: raise RuntimeError(f"migrate_legacy_batch {r.status_code}: {r.text[:200]}")
        row = r.json(); row = row[0] if isinstance(row, list) else row
        return row["inserted"], row["duplicates"]

    def count_items(self, user_id: str) -> int:
        r = self._req("GET", "/rest/v1/oneclist_items", params={"user_id": f"eq.{user_id}", "select": "id"},
                      headers={"Prefer": "count=exact", "Range": "0-0"})
        return int(r.headers.get("content-range", "*/0").split("/")[-1])

# ───────────── Django ORM readers (run inside the Django project) ─────────────
def django_users(email: str | None, limit: int | None) -> Iterator[dict]:
    import django; django.setup()
    from django.contrib.auth import get_user_model
    qs = get_user_model().objects.order_by("id")
    if email: qs = qs.filter(email__iexact=email)
    if limit: qs = qs[:limit]
    yield from qs.values("id", "username", "email", "first_name", "last_name", "is_active", "is_subscribed", "email_verified").iterator(chunk_size=2000)

def django_bookmarks(user_id: int) -> Iterator[dict]:
    from bookmarks.models import Bookmark
    qs = (Bookmark.objects.filter(category__user_id=user_id).select_related("category").order_by("id"))
    for b in qs.iterator(chunk_size=1000):
        yield {"id": b.id, "url": b.url, "name": b.name, "description": b.description, "timestamp": b.timestamp, "tags": b.tags,
               "category_title": b.category.title, "category_private": b.category.private,
               "embedding": None if b.embedding is None else list(b.embedding), "embedding_model": b.embedding_model}

# ───────────── orchestration ─────────────
@dataclass
class Report:
    users_created: int = 0; users_existing: int = 0; users_skipped: dict = field(default_factory=dict)
    bookmarks_seen: int = 0; bookmarks_inserted: int = 0; bookmarks_duplicate: int = 0; bookmarks_skipped: dict = field(default_factory=dict)
    private_bookmarks: int = 0; mismatches: list = field(default_factory=list)
    problems: list = field(default_factory=list)   # rows for the CSV

def bump(d: dict, k: str): d[k] = d.get(k, 0) + 1

def run(sb: Supabase | None, users: Iterable[dict], bookmarks_for, execute: bool, folder_tags: bool = True, verify: bool = False, log=print) -> Report:
    rep = Report(); seen_emails: dict[str, int] = {}
    for u in users:
        t = transform_user(u)
        if isinstance(t, str): bump(rep.users_skipped, t); rep.problems.append(("user", u["id"], t)); continue
        if t["email"] in seen_emails:                       # Django allows duplicate emails; Supabase does not
            bump(rep.users_skipped, "duplicate-email"); rep.problems.append(("user", u["id"], f"duplicate-email-of-{seen_emails[t['email']]}")); continue
        seen_emails[t["email"]] = u["id"]
        if execute:
            res = sb.create_user(t)
            if res == "created": rep.users_created += 1
            elif res == "exists": rep.users_existing += 1
            else: bump(rep.users_skipped, res); rep.problems.append(("user", u["id"], res)); continue
        # bookmarks for this user
        batch: list[dict] = []; sent = 0; user_inserted = 0
        def flush():
            nonlocal batch, sent, user_inserted
            if batch and execute:
                ins, dup = sb.migrate_batch(t["id"], batch); rep.bookmarks_inserted += ins; rep.bookmarks_duplicate += dup; user_inserted += ins
            sent += len(batch); batch = []
        for b in bookmarks_for(u["id"]):
            rep.bookmarks_seen += 1
            tb = transform_bookmark(b, folder_tags)
            if isinstance(tb, str): bump(rep.bookmarks_skipped, tb); rep.problems.append(("bookmark", b["id"], tb)); continue
            rep.private_bookmarks += tb["is_private"]
            batch.append(tb)
            if len(batch) >= BATCH: flush()
        flush()
        if execute and verify:
            got = sb.count_items(t["id"])          # rows now in Supabase must be at least what this run inserted
            if got < user_inserted: rep.mismatches.append((u["id"], user_inserted, got))
        log(f"user {u['id']}: {sent} bookmarks")
    return rep

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--execute", action="store_true", help="actually write to Supabase (default: dry run)")
    ap.add_argument("--email"); ap.add_argument("--limit", type=int)
    ap.add_argument("--no-folder-tags", action="store_true"); ap.add_argument("--verify", action="store_true")
    ap.add_argument("--report", default="migration_report.csv")
    a = ap.parse_args(argv)
    sb = None
    if a.execute:
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key: print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr); return 2
        sb = Supabase(url, key)
    else:
        print("DRY RUN: reading and transforming only. Add --execute to write.")
    rep = run(sb, django_users(a.email, a.limit), django_bookmarks, a.execute, not a.no_folder_tags, a.verify)
    with open(a.report, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["kind", "django_id", "reason"]); w.writerows(rep.problems)
    print(json.dumps({k: v for k, v in rep.__dict__.items() if k != "problems"}, indent=2, default=str))
    print(f"Skipped/conflicting rows are listed in {a.report}")
    return 0 if not rep.mismatches else 1

if __name__ == "__main__":
    sys.exit(main())
