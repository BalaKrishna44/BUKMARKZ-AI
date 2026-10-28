"""Bookmark search for the Bukmarkz MCP server.

Every value that reaches SQL is a bound parameter (%s, psycopg style). Only constant SQL text
is ever concatenated, and the only dynamic part of it is a *count* of placeholders.

User text is turned into three safe shapes:
  * to_tsquery string  "'nextjs' & 'performant' & 'routing':*"   (tokens are letters/digits only)
  * ILIKE patterns     "%nextjs%" with % _ \\ escaped
  * pgvector literal   "[0.1,0.2,...]" built from validated floats
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Sequence

MAX_TERMS = 8        # more terms than this add cost, not relevance
MAX_TERM_LEN = 64
MAX_QUERY_LEN = 500
MAX_LIMIT = 50
DEFAULT_LIMIT = 20
EMBEDDING_DIM = 1536  # change to match your vector(N) column

# letters and digits in any script; everything else (quotes, & | ! : ( ) < > * \ % _ - . etc.) is a separator
_WORD = re.compile(r"[^\W_]+", re.UNICODE)

# text searched by full-text and ILIKE; keep in sync with your schema
_DOC = "coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(meta_description,'') || ' ' || coalesce(url,'') || ' ' || coalesce(array_to_string(ai_tags,' '),'')"
_COLS = "id, title, url, summary"


class SearchInputError(ValueError):
    """The caller's input cannot be turned into a search."""


def tokenize(query: str) -> list[str]:
    """'  Next.js  "performant" routing!! ' -> ['next', 'js', 'performant', 'routing'] (lowercased, deduped, capped)."""
    if not isinstance(query, str):
        raise SearchInputError("query must be a string")
    text = unicodedata.normalize("NFKC", query[:MAX_QUERY_LEN]).replace("\x00", " ")
    seen: list[str] = []
    for m in _WORD.finditer(text):
        t = m.group(0).lower()[:MAX_TERM_LEN]
        if t not in seen:
            seen.append(t)
        if len(seen) == MAX_TERMS:
            break
    return seen


def to_tsquery_string(tokens: Sequence[str], prefix_last: bool = True) -> str:
    """['a','b'] -> "'a' & 'b':*"  . Tokens are \\w-only so quoting can never be broken out of."""
    if not tokens:
        raise SearchInputError("no searchable words in query")
    parts = [f"'{t}'" for t in tokens]
    if prefix_last:
        parts[-1] += ":*"      # type-ahead: 'rout' still matches 'routing'
    return " & ".join(parts)


def like_pattern(token: str) -> str:
    """Escape LIKE wildcards (backslash is the escape char) and wrap for substring match."""
    return "%" + token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def clamp_limit(limit: Any, default: int = DEFAULT_LIMIT) -> int:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        return default
    return max(1, min(n, MAX_LIMIT))


def vector_literal(embedding: Sequence[float], dim: int = EMBEDDING_DIM) -> str:
    if len(embedding) != dim:
        raise SearchInputError(f"embedding must have {dim} dimensions")
    vals = []
    for x in embedding:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
            raise SearchInputError("embedding must contain finite numbers")
        vals.append(repr(float(x)))
    return "[" + ",".join(vals) + "]"


# ───────────── query builders: return (sql, params), never execute ─────────────
def build_fts_query(query: str, user_id: str, limit: Any = DEFAULT_LIMIT) -> tuple[str, list[Any]]:
    tsq = to_tsquery_string(tokenize(query))
    sql = (
        f"SELECT {_COLS}, ts_rank(to_tsvector('simple', {_DOC}), q.tsq) AS score "
        "FROM oneclist_items, (SELECT to_tsquery('simple', %s) AS tsq) AS q "
        f"WHERE user_id = %s AND to_tsvector('simple', {_DOC}) @@ q.tsq "
        "ORDER BY score DESC, id LIMIT %s"
    )
    return sql, [tsq, user_id, clamp_limit(limit)]


def build_ilike_query(query: str, user_id: str, limit: Any = DEFAULT_LIMIT) -> tuple[str, list[Any]]:
    tokens = tokenize(query)
    if not tokens:
        raise SearchInputError("no searchable words in query")
    # every word must appear somewhere (AND), in any column (OR); placeholder count is the only dynamic SQL
    cond = " AND ".join([f"({_DOC}) ILIKE %s ESCAPE '\\'"] * len(tokens))
    sql = f"SELECT {_COLS}, 0::float AS score FROM oneclist_items WHERE user_id = %s AND {cond} ORDER BY id DESC LIMIT %s"
    return sql, [user_id, *map(like_pattern, tokens), clamp_limit(limit)]


def build_vector_query(embedding: Sequence[float], user_id: str, limit: Any = DEFAULT_LIMIT) -> tuple[str, list[Any]]:
    lit = vector_literal(embedding)
    sql = (
        f"SELECT {_COLS}, 1 - (embedding <=> %s::vector) AS score FROM oneclist_items "
        "WHERE user_id = %s AND embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT %s"
    )
    return sql, [lit, user_id, lit, clamp_limit(limit)]


# ───────────── handler ─────────────
def _run(cur, sql: str, params: list[Any]) -> list[dict[str, Any]]:
    cur.execute(sql, params)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def search_bookmarks(conn, query: str, *, user_id: str, limit: Any = DEFAULT_LIMIT,
                     embedding: Sequence[float] | None = None) -> dict[str, Any]:
    """Semantic search if an embedding is given, else full-text with an ILIKE fallback.

    `conn` is any DB-API connection using %s placeholders (psycopg 3). Returns {"mode", "results"}.
    Bad input raises SearchInputError (turn it into a tool error message, not a stack trace).
    """
    if not user_id:
        raise SearchInputError("user_id is required")
    with conn.cursor() as cur:
        if embedding is not None:
            return {"mode": "vector", "results": _run(cur, *build_vector_query(embedding, user_id, limit))}
        rows = _run(cur, *build_fts_query(query, user_id, limit))
        if rows:
            return {"mode": "fulltext", "results": rows}
        return {"mode": "ilike", "results": _run(cur, *build_ilike_query(query, user_id, limit))}
