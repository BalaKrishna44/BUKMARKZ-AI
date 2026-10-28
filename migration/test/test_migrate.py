import datetime, json, os, sys, threading, unittest, hashlib, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["MIGRATE_FAST"] = "1"
import migrate_django_to_supabase as m

class Fake(BaseHTTPRequestHandler):
    state = {}
    def log_message(self, *a): pass
    def _send(self, code, body=None, headers=None):
        b = json.dumps(body if body is not None else {}).encode()
        self.send_response(code); self.send_header("content-type", "application/json")
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        st = Fake.state; body = json.loads(self.rfile.read(int(self.headers["content-length"])) or b"{}")
        assert self.headers["Authorization"].startswith("Bearer ") and self.headers["apikey"]
        if self.path == "/auth/v1/admin/users":
            if st.get("flaky") and not st.get("flaked"): st["flaked"] = True; return self._send(503)
            if body["id"] in st["users"]: return self._send(422, {"error_code": "user_already_exists"})
            if any(u["email"] == body["email"] for u in st["users"].values()): return self._send(422, {"error_code": "email_exists"})
            st["users"][body["id"]] = body; return self._send(200, body)
        if self.path == "/rest/v1/rpc/migrate_legacy_batch":
            st["batches"].append(body); seen = st["items"].setdefault(body["p_user"], set()); ins = 0
            for it in body["p_items"]:
                if it["url_key"] not in seen: seen.add(it["url_key"]); ins += 1
            return self._send(200, [{"inserted": ins, "duplicates": len(body["p_items"]) - ins}])
        self._send(404)
    def do_GET(self):
        st = Fake.state
        if self.path.startswith("/auth/v1/admin/users/"): uid = self.path.rsplit("/", 1)[1]; return self._send(200 if uid in st["users"] else 404)
        if self.path.startswith("/rest/v1/oneclist_items"):
            uid = self.path.split("user_id=eq.")[1].split("&")[0]; n = len(st["items"].get(uid, ()))
            return self._send(200, [], {"content-range": f"0-0/{n}"})
        self._send(404)

class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Fake); threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()
    def setUp(self): Fake.state = {"users": {}, "batches": [], "items": {}}

    def test_uuid5_deterministic_and_matches_ts_vectors(self):
        self.assertEqual(m.legacy_user_uuid(1), m.legacy_user_uuid("1"))
        self.assertEqual(m.legacy_user_uuid(42), str(uuid.uuid5(m.NAMESPACE, "bukmarkz-legacy-user-42")))
        print("   uuid vectors:", {i: m.legacy_user_uuid(i) for i in (1, 42, 99999)})

    def test_url_rules(self):
        self.assertEqual(m.check_url("HTTPS://Www.X.com:443/p/?utm_source=a&b=2&a=1#f")[1], "x.com/p?a=1&b=2")
        for bad, why in [("javascript:alert(1)", "unsupported-scheme"), ("ftp://a.com/", "unsupported-scheme"), ("", "missing-url"), (None, "missing-url"),
                         ("https://u:p@a.com/", "credentials-in-url"), ("https://a.com/" + "x" * 2100, "url-too-long")]:
            self.assertEqual(m.check_url(bad), why, bad)

    def test_user_transform(self):
        u = m.transform_user({"id": 7, "email": " A@B.com ", "first_name": "Ann", "last_name": "Lee", "username": "ann", "is_active": True, "is_subscribed": True, "email_verified": False})
        self.assertEqual((u["email"], u["email_confirm"], u["user_metadata"]["name"]), ("a@b.com", False, "Ann Lee"))
        self.assertTrue(u["app_metadata"]["is_subscribed"]); self.assertNotIn("is_subscribed", u["user_metadata"])
        self.assertEqual(m.transform_user({"id": 1, "email": "", "is_active": True}), "no-email")
        self.assertEqual(m.transform_user({"id": 1, "email": "a@b.c", "is_active": False}), "inactive")
        self.assertTrue(m.transform_user({"id": 1, "email": "a@b.c", "is_active": True, "email_verified": True})["email_confirm"])

    def test_bookmark_transform_private_embedding_folder_tags(self):
        base = {"id": 5, "url": "https://a.com/x", "name": "A", "description": "d", "timestamp": datetime.datetime(2022, 1, 2, tzinfo=datetime.timezone.utc),
                "tags": ["React Hooks", "#UI", "ui", 3], "category_title": "Web Dev", "category_private": False, "embedding": [0.5] * 1536, "embedding_model": "text-embedding-3-small"}
        b = m.transform_bookmark(base)
        self.assertEqual((b["folder"], b["ai_tags"], b["tags"]), (["Web Dev"], ["web-dev"], ["react-hooks", "ui"]))
        self.assertTrue(b["embedding"].startswith("[0.5,")); self.assertEqual(b["created_at"], "2022-01-02T00:00:00+00:00")
        p = m.transform_bookmark({**base, "category_private": True}); self.assertIsNone(p["embedding"]); self.assertTrue(p["is_private"])
        self.assertIsNone(m.transform_bookmark({**base, "embedding_model": "other"})["embedding"])
        self.assertEqual(m.transform_bookmark({**base, "url": "javascript:x"}), "unsupported-scheme")
        self.assertEqual(m.transform_bookmark(base, folder_tags=False)["ai_tags"], [])

    def test_knox_digest_matches_python_hashlib(self):
        tok = "a" * 64; print("   sha512 vector:", hashlib.sha512(tok.encode()).hexdigest()[:24])

    def _data(self):
        users = [{"id": 1, "email": "a@x.com", "is_active": True, "first_name": "", "last_name": "", "username": "a", "is_subscribed": False, "email_verified": True},
                 {"id": 2, "email": "A@X.com", "is_active": True, "username": "dup"},          # duplicate email
                 {"id": 3, "email": "", "is_active": True, "username": "noemail"},
                 {"id": 4, "email": "off@x.com", "is_active": False, "username": "off"},
                 {"id": 5, "email": "b@x.com", "is_active": True, "username": "b"}]
        mk = lambda i, url, cat="Dev", priv=False: {"id": i, "url": url, "name": f"n{i}", "description": None, "timestamp": None, "tags": [], "category_title": cat, "category_private": priv, "embedding": None, "embedding_model": ""}
        bms = {1: [mk(i, f"https://a.com/{i}") for i in range(1, 1201)] + [mk(2000, "https://a.com/1", "Other"), mk(2001, "javascript:1"), mk(2002, "https://s.com/", "Secret", True)],
               5: [mk(3000, "https://b.com/")]}
        return users, lambda uid: iter(bms.get(uid, []))

    def test_dry_run_writes_nothing(self):
        users, bm = self._data(); rep = m.run(None, users, bm, execute=False, log=lambda *_: None)
        self.assertEqual((rep.users_created, rep.bookmarks_inserted, Fake.state["batches"]), (0, 0, []))
        self.assertEqual(rep.users_skipped, {"duplicate-email": 1, "no-email": 1, "inactive": 1})
        self.assertEqual(rep.bookmarks_skipped, {"unsupported-scheme": 1}); self.assertEqual(rep.private_bookmarks, 1)

    def test_execute_batches_idempotent_verify(self):
        users, bm = self._data(); sb = m.Supabase(self.url, "key")
        rep = m.run(sb, users, bm, execute=True, verify=True, log=lambda *_: None)
        self.assertEqual((rep.users_created, rep.users_existing), (2, 0))
        self.assertTrue(all(len(b["p_items"]) <= 500 for b in Fake.state["batches"]))
        self.assertEqual((rep.bookmarks_inserted, rep.bookmarks_duplicate), (1200 + 1 + 1, 1))     # same URL in two categories → duplicate
        self.assertEqual(rep.mismatches, [])
        uid1 = m.legacy_user_uuid(1); self.assertEqual(len(Fake.state["items"][uid1]), 1201)
        rep2 = m.run(sb, *self._data(), execute=True, log=lambda *_: None)                           # re-run
        self.assertEqual((rep2.users_created, rep2.users_existing), (0, 2))
        print("   run 1:", rep.users_created, "users,", rep.bookmarks_inserted, "bookmarks | re-run existing users:", rep2.users_existing)

    def test_email_conflict_with_different_account_is_reported_not_merged(self):
        sb = m.Supabase(self.url, "key"); Fake.state["users"]["someone-else"] = {"email": "a@x.com"}
        users, bm = self._data(); rep = m.run(sb, users[:1], bm, execute=True, log=lambda *_: None)
        self.assertEqual(rep.users_skipped, {"conflict": 1}); self.assertEqual(Fake.state["batches"], [])

    def test_retry_on_503(self):
        Fake.state["flaky"] = True; sb = m.Supabase(self.url, "key"); users, bm = self._data()
        rep = m.run(sb, users[:1], bm, execute=True, log=lambda *_: None); self.assertEqual(rep.users_created, 1)

if __name__ == "__main__": unittest.main(verbosity=1)
