# Bukmarkz MCP search fix

Drop `tools/search.py` into the server and call it from your tool:

```python
from tools.search import search_bookmarks, SearchInputError

@mcp.tool()
def search(query: str, limit: int = 20) -> dict:
    try:
        with get_conn() as conn:                       # psycopg 3 connection
            return search_bookmarks(conn, query, user_id=current_user_id(), limit=limit)
    except SearchInputError as e:
        return {"error": str(e)}
```

Root cause reproduced: `to_tsquery('nextjs performant routing')` -> `syntax error in tsquery`.
Fix: user text is split into letter/digit tokens, joined as `'a' & 'b' & 'c':*`, and passed as a bound parameter.

Tests: `python3 -m unittest discover -s tests -t .` (no DB) and `tests/integration_pg.py` (needs a Postgres with the table).
Adjust: `EMBEDDING_DIM`, column names in `_DOC`, and `user_id` source. For speed add a generated tsvector column + GIN index.
