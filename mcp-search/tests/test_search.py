import math, unittest
from tools import search as s


class Tokenize(unittest.TestCase):
    def test_single(self): self.assertEqual(s.tokenize("nextjs"), ["nextjs"])
    def test_multi(self): self.assertEqual(s.tokenize("nextjs performant routing"), ["nextjs", "performant", "routing"])
    def test_whitespace_case_dupes(self): self.assertEqual(s.tokenize("  Next   NEXT\tjs\n"), ["next", "js"])
    def test_unicode(self): self.assertEqual(s.tokenize("café 東京"), ["café", "東京"])
    def test_special_chars_are_separators(self):
        self.assertEqual(s.tokenize("rock & roll | !x :* (a) <-> b'c \"d\" \\ % _"), ["rock", "roll", "x", "a", "b", "c", "d"])
    def test_sql_injection_text(self):
        self.assertEqual(s.tokenize("'; DROP TABLE oneclist_items;--"), ["drop", "table", "oneclist", "items"])
    def test_only_punctuation(self): self.assertEqual(s.tokenize("&&& ''' !!"), [])
    def test_nul_byte(self): self.assertEqual(s.tokenize("a\x00b"), ["a", "b"])
    def test_caps(self):
        self.assertEqual(len(s.tokenize(" ".join(f"w{i}" for i in range(50)))), s.MAX_TERMS)
        self.assertEqual(len(s.tokenize("x" * 1000)[0]), s.MAX_TERM_LEN)
    def test_non_string(self):
        with self.assertRaises(s.SearchInputError): s.tokenize(None)  # type: ignore


class TsQuery(unittest.TestCase):
    def test_matches_spec_example(self):
        self.assertEqual(s.to_tsquery_string(s.tokenize("nextjs performant routing"), prefix_last=False), "'nextjs' & 'performant' & 'routing'")
    def test_prefix_last(self): self.assertEqual(s.to_tsquery_string(["a", "b"]), "'a' & 'b':*")
    def test_single(self): self.assertEqual(s.to_tsquery_string(["nextjs"], prefix_last=False), "'nextjs'")
    def test_empty_raises(self):
        with self.assertRaises(s.SearchInputError): s.to_tsquery_string([])


class Like(unittest.TestCase):
    def test_escape(self): self.assertEqual(s.like_pattern("50%_\\"), "%50\\%\\_\\\\%")
    def test_plain(self): self.assertEqual(s.like_pattern("abc"), "%abc%")


class Builders(unittest.TestCase):
    EVIL = "x' OR '1'='1'; DROP TABLE oneclist_items;--"

    def test_fts_binds_everything(self):
        sql, p = s.build_fts_query(self.EVIL, "u1", 10)
        self.assertEqual(sql.count("%s"), len(p))
        self.assertNotIn("DROP", sql); self.assertNotIn("1'='1", sql)
        self.assertEqual(p[1:], ["u1", 10]); self.assertTrue(p[0].startswith("'x' & 'or'"))
    def test_ilike_placeholder_count(self):
        for q in ("a", "a b", "a b c d"):
            sql, p = s.build_ilike_query(q, "u1")
            self.assertEqual(sql.count("%s"), len(p)); self.assertEqual(len(p), 2 + len(q.split()))
    def test_ilike_wildcards_escaped(self):
        # '%' and '_' are separators in tokenize, so they can never reach the pattern; the pattern escaper is defence in depth
        self.assertEqual(s.build_ilike_query("100% _all", "u")[1][1:-1], ["%100%", "%all%"])
    def test_limit_clamped(self):
        for raw, want in ((1000, s.MAX_LIMIT), (0, 1), (-5, 1), ("7", 7), ("abc", s.DEFAULT_LIMIT), (None, s.DEFAULT_LIMIT)):
            self.assertEqual(s.build_fts_query("a", "u", raw)[1][-1], want, raw)
    def test_empty_query(self):
        for f in (s.build_fts_query, s.build_ilike_query):
            with self.assertRaises(s.SearchInputError): f("!!! &&", "u")
    def test_vector_validation(self):
        good = [0.5] * s.EMBEDDING_DIM
        sql, p = s.build_vector_query(good, "u"); self.assertEqual(sql.count("%s"), len(p)); self.assertTrue(p[0].startswith("[0.5,"))
        for bad in ([0.1] * 3, [math.nan] * s.EMBEDDING_DIM, [math.inf] * s.EMBEDDING_DIM, ["1); drop"] * s.EMBEDDING_DIM, [True] * s.EMBEDDING_DIM):
            with self.assertRaises(s.SearchInputError): s.build_vector_query(bad, "u")


class FakeCur:
    def __init__(self, script): self.script, self.calls, self.description, self._rows = script, [], None, []
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params):
        self.calls.append((sql, params)); self._rows = self.script.pop(0)
        self.description = [("id",), ("title",), ("url",), ("summary",), ("score",)]
    def fetchall(self): return self._rows
class FakeConn:
    def __init__(self, script): self.cur = FakeCur(script)
    def cursor(self): return self.cur


class Handler(unittest.TestCase):
    ROW = [(1, "t", "https://x", "s", 0.5)]
    def test_fulltext_hit(self):
        c = FakeConn([self.ROW]); r = s.search_bookmarks(c, "nextjs performant routing", user_id="u")
        self.assertEqual(r["mode"], "fulltext"); self.assertEqual(r["results"][0]["title"], "t"); self.assertEqual(len(c.cur.calls), 1)
    def test_falls_back_to_ilike(self):
        c = FakeConn([[], self.ROW]); r = s.search_bookmarks(c, "next", user_id="u"); self.assertEqual(r["mode"], "ilike"); self.assertEqual(len(c.cur.calls), 2)
    def test_vector_mode(self):
        c = FakeConn([self.ROW]); r = s.search_bookmarks(c, "", user_id="u", embedding=[0.1] * s.EMBEDDING_DIM); self.assertEqual(r["mode"], "vector")
    def test_requires_user(self):
        with self.assertRaises(s.SearchInputError): s.search_bookmarks(FakeConn([]), "a", user_id="")
    def test_garbage_query_never_touches_db(self):
        c = FakeConn([])
        with self.assertRaises(s.SearchInputError): s.search_bookmarks(c, "&&&", user_id="u")
        self.assertEqual(c.cur.calls, [])

if __name__ == "__main__":
    unittest.main()
