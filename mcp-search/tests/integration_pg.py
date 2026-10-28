"""Runs the REAL generated SQL on a real PostgreSQL through psql's extended protocol (\\bind), i.e. true server-side parameters.
Usage: PGHOST=/tmp PGPORT=5499 PGUSER=postgres python3 -m unittest tests.integration_pg"""
import re, subprocess, unittest
from tools import search as s

def q(v):  # psql single-quoted meta-command argument
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"

class PsqlCur:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params):
        n = [0]
        def num(_): n[0] += 1; return f"${n[0]}"
        sql = re.sub(r"%s", num, sql)
        script = f"\\pset footer off\n\\pset fieldsep '\x1f'\n{sql}\n\\bind {' '.join(q(p) for p in params)}\n\\g\n"
        r = subprocess.run(["psql", "-X", "-q", "-A", "-v", "ON_ERROR_STOP=1"], input=script, capture_output=True, text=True)
        if r.returncode or "ERROR" in r.stderr: raise RuntimeError(r.stderr.strip())
        lines = r.stdout.strip("\n").split("\n") if r.stdout.strip() else []
        self.description = [(c,) for c in lines[0].split("\x1f")] if lines else [("id",)]
        self._rows = [tuple(l.split("\x1f")) for l in lines[1:]]
    def fetchall(self): return self._rows
class Conn:
    def cursor(self): return PsqlCur()

class RealPg(unittest.TestCase):
    def titles(self, query, user="u1"):
        r = s.search_bookmarks(Conn(), query, user_id=user); return r["mode"], sorted(x["title"] for x in r["results"])
    def test_single_word(self): self.assertEqual(self.titles("nextjs"), ("fulltext", ["Next.js performant routing guide"]))
    def test_multi_word(self): self.assertEqual(self.titles("nextjs performant routing")[1], ["Next.js performant routing guide"])
    def test_prefix_typeahead(self): self.assertEqual(self.titles("performant rout")[1], ["Next.js performant routing guide"])
    def test_dotted_term(self): self.assertEqual(self.titles("Next.js routing")[1], ["Next.js performant routing guide"])
    def test_tags_searchable(self): self.assertEqual(self.titles("react")[1], ["Next.js performant routing guide"])
    def test_user_isolation(self): self.assertEqual(self.titles("secret")[1], []); self.assertEqual(self.titles("secret", "u2")[1], ["nextjs performant routing (other user)"])
    def test_tsquery_syntax_chars(self):
        for evil in ["rock & roll", "rock | roll", "!rock", "rock:*", "(rock", "rock)", "a <-> b", "'", "\"", "\\", "rock &", "& & &"]:
            try: self.titles(evil)
            except s.SearchInputError: pass   # nothing searchable: clean error, not a DB syntax error
    def test_rock_and_roll(self): self.assertEqual(self.titles("rock & roll")[1], ["Rock & roll history"])
    def test_ilike_wildcards_are_literal(self): self.assertEqual(self.titles("100% off_sale")[1], ["100% off_sale deals"])
    def test_injection_is_inert(self):
        self.titles("x'; DROP TABLE oneclist_items; --")
        self.assertEqual(self.titles("nextjs")[1], ["Next.js performant routing guide"])   # table still there
    def test_ilike_fallback_substring(self): self.assertEqual(self.titles("outin")[0:2], ("ilike", ["Next.js performant routing guide"]))
    def test_empty_result(self): self.assertEqual(self.titles("zzzznope"), ("ilike", []))

if __name__ == "__main__": unittest.main()
