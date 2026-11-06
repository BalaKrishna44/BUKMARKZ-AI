/**
 * MOCK DATA for demos. Nothing here comes from a database. The links are real, stable documentation pages so the demo never opens a dead
 * page, and the summaries are short, general descriptions written for this demo, not quotes from those pages.
 * Replace each export with a Supabase query (see README) and keep the types.
 */
export interface DemoLink {
  id: string; title: string; url: string; category: string; tags: string[]; summary: string;
  saved: string;           // display string, e.g. "2d ago"
  unread: boolean; thisWeek: boolean; hasNote: boolean;
}
export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

export const CATEGORIES = ['Databases', 'Frontend', 'Standards', 'Extensions', 'AI'] as const;
export const FILTERS = ['Unread', 'This week', 'Has note'] as const;

export const LINKS: DemoLink[] = [
  { id: 'l1', title: 'pgvector: vector similarity search for Postgres', url: 'https://github.com/pgvector/pgvector', category: 'Databases', tags: ['postgres', 'vectors', 'search', 'embeddings'],
    summary: 'Adds a vector column type and nearest-neighbour search to Postgres. It supports HNSW and IVFFlat indexes.', saved: '2d ago', unread: false, thisWeek: true, hasNote: true },
  { id: 'l2', title: 'Supabase guide: AI and vectors', url: 'https://supabase.com/docs/guides/ai', category: 'AI', tags: ['supabase', 'embeddings', 'rag', 'vectors'],
    summary: 'Explains storing embeddings next to your rows and querying them with SQL for semantic search.', saved: '3d ago', unread: true, thisWeek: true, hasNote: false },
  { id: 'l3', title: 'PostgreSQL docs: row security policies', url: 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html', category: 'Databases', tags: ['postgres', 'security', 'rls', 'policies'],
    summary: 'Row-level security lets a table restrict which rows each user can see or change, using policies.', saved: '12d ago', unread: true, thisWeek: false, hasNote: false },
  { id: 'l4', title: 'Next.js docs: the App Router', url: 'https://nextjs.org/docs/app', category: 'Frontend', tags: ['nextjs', 'react', 'routing', 'server components'],
    summary: 'Reference for routing, layouts, server and client components, and data fetching in the App Router.', saved: '1d ago', unread: false, thisWeek: true, hasNote: false },
  { id: 'l5', title: 'Tailwind CSS documentation', url: 'https://tailwindcss.com/docs', category: 'Frontend', tags: ['tailwind', 'css', 'design', 'utility classes'],
    summary: 'Utility-first CSS framework docs: core concepts, responsive design, dark mode and customization.', saved: '21d ago', unread: true, thisWeek: false, hasNote: false },
  { id: 'l6', title: 'Chrome extensions documentation', url: 'https://developer.chrome.com/docs/extensions', category: 'Extensions', tags: ['chrome', 'extension', 'manifest', 'browser'],
    summary: 'Guides and API reference for building Manifest V3 browser extensions: service workers, permissions and content scripts.', saved: '9d ago', unread: false, thisWeek: false, hasNote: true },
  { id: 'l7', title: 'RFC 4180: the CSV format', url: 'https://www.rfc-editor.org/rfc/rfc4180', category: 'Standards', tags: ['csv', 'rfc', 'parsing', 'format'],
    summary: 'Documents the common CSV format, including quoted fields that may contain commas and line breaks.', saved: '30d ago', unread: true, thisWeek: false, hasNote: false },
  { id: 'l8', title: 'Model Context Protocol', url: 'https://modelcontextprotocol.io', category: 'AI', tags: ['mcp', 'agents', 'tools', 'protocol'],
    summary: 'An open protocol for connecting AI applications to tools and data sources in a standard way.', saved: '5d ago', unread: false, thisWeek: true, hasNote: false },
];

export const RESURFACE: { id: string; why: string }[] = [
  { id: 'l3', why: 'Saved 12 days ago and never reopened' },
  { id: 'l7', why: 'A month old. Worth a second look?' },
  { id: 'l5', why: 'Matches what you saved this week' },
  { id: 'l6', why: 'You added a note here, then went quiet' },
  { id: 'l2', why: 'Related to pgvector, saved 2 days ago' },
];

export interface QuizQ { id: string; fromId: string; question: string; options: string[]; answerIndex: number; explanation: string }
export const QUIZ: QuizQ = {
  id: 'q1', fromId: 'l1',
  question: 'Which pgvector index type trades slower builds and more memory for a better speed-recall tradeoff?',
  options: ['IVFFlat', 'HNSW', 'B-tree', 'GIN'], answerIndex: 1,
  explanation: 'HNSW builds more slowly and uses more memory than IVFFlat, but generally gives better query performance for the same recall.',
};

export interface ShortItem {
  id: string; platform: 'youtube' | 'instagram'; title: string; creator: string; url: string; embedId: string | null;
  seconds: number; tags: string[]; summary: string; hue: number; saved: boolean;
}
/** `url` points at the platform's own shorts/reels page so the demo never opens a dead link. `embedId` (an 11-character YouTube id) is null in the mock; set it to play inline. */
export const SHORTS: ShortItem[] = [
  { id: 's1', platform: 'youtube', title: 'Three Postgres indexes you should know', creator: '@sample.creator', url: 'https://www.youtube.com/shorts', embedId: null, seconds: 42, tags: ['postgres', 'databases'], summary: 'A quick tour of when to reach for a B-tree, a GIN and an HNSW index.', hue: 160, saved: true },
  { id: 's2', platform: 'instagram', title: 'My desk setup for deep work', creator: '@sample.studio', url: 'https://www.instagram.com/reels/', embedId: null, seconds: 28, tags: ['productivity', 'setup'], summary: 'Cable management, one monitor and a timer. Saved for the lighting tip.', hue: 28, saved: false },
  { id: 's3', platform: 'youtube', title: 'CSS container queries in 30 seconds', creator: '@sample.frontend', url: 'https://www.youtube.com/shorts', embedId: null, seconds: 31, tags: ['css', 'frontend'], summary: 'Style a component by the size of its container instead of the viewport.', hue: 215, saved: false },
  { id: 's4', platform: 'instagram', title: 'One-pan lemon pasta', creator: '@sample.kitchen', url: 'https://www.instagram.com/reels/', embedId: null, seconds: 54, tags: ['recipe', 'dinner'], summary: 'Pasta, lemon, parmesan and pasta water, all in one pan.', hue: 48, saved: true },
];

/** The sandbox on the landing page searches these (a subset of LINKS), entirely in the visitor's browser. */
export const SANDBOX_IDS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'];
export const SANDBOX_SUGGESTIONS = ['Which index should I use for vector search?', 'How do I lock down rows per user?', 'What format are CSV exports?', 'How do I build a browser extension?'];
