/**
 * BookmarkWorkspace: an "actionable bookmark & knowledge workspace" dashboard.
 *
 *   Sidebar (Inbox, All Bookmarks, Reminders, Collections, Tags, AI Chat)
 *   -> visual card grid (favicon, preview, AI tags, quick actions, note/reminder badges)
 *   -> slide-over drawer (metadata, AI TL;DR, Markdown notes, reminder scheduler, scraped text)
 *
 * Requirements: React 18+, Tailwind CSS 3.4+ (class names are also valid in v4), lucide-react.
 * No other dependencies. Everything runs on mock state so the UI is fully interactive.
 *
 * Where to plug in your backend (search for "MOCK:"):
 *   - the initial data            -> GET /api/bookmarks, /api/collections
 *   - addBookmark() enrichment    -> POST /api/bookmarks (your tagging/summary pipeline)
 *   - semanticScore()             -> GET /api/search?q=... (pgvector)
 *   - buildAnswer()               -> your RAG chat endpoint (stream the response)
 *   - reminder scheduling         -> POST /api/reminders (push/email)
 *
 * Theme: brand colours are the literal classes bg-[#14213d] (navy) and bg-[#fca311] (orange).
 * Find-and-replace them to re-theme. Dark mode follows the OS (Tailwind's default `media` strategy).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellPlus,
  BellRing,
  Bold,
  Bookmark as BookmarkIcon,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Code,
  ExternalLink,
  Eye,
  Folder,
  Heading2,
  Highlighter,
  Inbox,
  Italic,
  Link2,
  List,
  Loader2,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';

/* ============================================================================================
 * Types
 * ========================================================================================== */

export type ViewId = 'inbox' | 'all' | 'reminders' | 'collections' | 'tags' | 'chat' | 'archive';
type SearchMode = 'keyword' | 'semantic';
type SortKey = 'newest' | 'oldest' | 'title' | 'due';
type DrawerFocus = 'note' | 'reminder' | null;

export interface Reminder {
  /** ISO timestamp */
  at: string;
  repeat: 'once' | 'weekly' | 'monthly';
  push: boolean;
  email: boolean;
}

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  /** AI executive summary (2 sentences) */
  summary: string;
  /** scraped main text, truncated */
  previewText: string;
  highlights: string[];
  /** AI-generated tags (editable) */
  tags: string[];
  /** true while the AI pipeline is still working on tags and summary */
  aiPending?: boolean;
  /** Markdown */
  note: string;
  reminder: Reminder | null;
  collectionId: string | null;
  inbox: boolean;
  archived: boolean;
  savedAt: string;
  readingMins: number;
  /** og:image; when missing (or it fails to load) a generated cover is shown */
  image?: string;
}

export interface Collection {
  id: string;
  name: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: string[];
  streaming?: boolean;
}

interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
}

export interface BookmarkWorkspaceProps {
  initialBookmarks?: BookmarkItem[];
  initialCollections?: Collection[];
}

/* ============================================================================================
 * Small utilities
 * ========================================================================================== */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function hueOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Overdue", "Today 5:30 PM", "Tomorrow 9:00 AM" or "Tue, Oct 21, 9:00 AM" */
export function formatDue(iso: string): { label: string; overdue: boolean; today: boolean } {
  const at = new Date(iso);
  const now = new Date();
  const dayDiff = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  const overdue = at.getTime() < now.getTime();
  if (overdue) return { label: dayDiff === 0 ? `Overdue · ${timeFmt.format(at)}` : `Overdue · ${dateFmt.format(at)}`, overdue, today: dayDiff === 0 };
  if (dayDiff === 0) return { label: `Today ${timeFmt.format(at)}`, overdue, today: true };
  if (dayDiff === 1) return { label: `Tomorrow ${timeFmt.format(at)}`, overdue, today: false };
  return { label: dateTimeFmt.format(at), overdue, today: false };
}

function relativeSaved(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days} d ago` : dateFmt.format(new Date(iso));
}

/** Value for <input type="datetime-local"> in the user's local time zone. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PresetKind = 'tomorrow' | 'weekend' | 'monday' | 'month';

function presetDate(kind: PresetKind): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  switch (kind) {
    case 'tomorrow':
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0);
      break;
    case 'weekend': {
      const add = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + add);
      d.setHours(10, 0);
      break;
    }
    case 'monday': {
      const add = (1 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + add);
      d.setHours(9, 0);
      break;
    }
    case 'month':
      d.setMonth(d.getMonth() + 1);
      d.setHours(9, 0);
      break;
  }
  return d;
}

/** Up to 3 tags, stopping early when they would no longer fit on one line of the card. */
function pickTags(tags: string[]): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const t of tags) {
    if (out.length === 3 || (out.length > 0 && chars + t.length > 20)) break;
    out.push(t);
    chars += t.length;
  }
  return out;
}

function normalizeTag(raw: string): string {
  return raw.toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9+#.\s-]/g, ' ').trim().replace(/\s+/g, '-').slice(0, 30);
}

/* ============================================================================================
 * Search (MOCK: replace semanticScore with your vector search endpoint)
 * ========================================================================================== */

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'what', 'how', 'about', 'have', 'has', 'are', 'was', 'that', 'this', 'from', 'saved', 'my', 'me', 'any', 'all', 'show', 'tell', 'give']);

const tokenize = (text: string) =>
  text.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));

/** Groups of related ideas: a stand-in for what embeddings give you for free. */
const CONCEPT_GROUPS: string[][] = [
  ['frontend', 'react', 'css', 'ui', 'components', 'layout', 'tailwind', 'grid', 'web', 'nextjs'],
  ['money', 'finance', 'investing', 'index-funds', 'etf', 'personal-finance', 'payments', 'stripe', 'savings'],
  ['design', 'ux', 'ui-design', 'usability', 'typography', 'visual-hierarchy', 'heuristics'],
  ['speed', 'performance', 'fast', 'core-web-vitals', 'vitals', 'seo'],
  ['learning', 'thinking', 'mental-models', 'decision-making', 'curiosity', 'essays', 'career'],
  ['work', 'productivity', 'planning', 'workflows', 'product-management', 'process'],
];

function expandTerms(tokens: string[]): Map<string, number> {
  const weights = new Map<string, number>();
  tokens.forEach((t) => weights.set(t, 1));
  for (const group of CONCEPT_GROUPS) {
    if (tokens.some((t) => group.some((g) => g === t || g.startsWith(t) || t.startsWith(g)))) {
      group.forEach((g) => {
        if (!weights.has(g)) weights.set(g, 0.55);
      });
    }
  }
  return weights;
}

/** 0..1 relevance. MOCK: weighted keyword overlap with synonym groups. */
export function semanticScore(item: BookmarkItem, query: string): number {
  const tokens = tokenize(query);
  if (!tokens.length) return 0;
  const terms = expandTerms(tokens);
  const title = item.title.toLowerCase();
  const summary = item.summary.toLowerCase();
  const text = `${item.previewText} ${item.note}`.toLowerCase();
  const tags = item.tags.map((t) => t.toLowerCase());
  let score = 0;
  terms.forEach((w, term) => {
    if (tags.some((t) => t === term || t.includes(term))) score += 3 * w;
    if (title.includes(term)) score += 2 * w;
    if (summary.includes(term)) score += 1 * w;
    if (text.includes(term)) score += 0.5 * w;
  });
  return Math.min(0.99, score / (tokens.length * 4));
}

function keywordMatches(item: BookmarkItem, query: string): boolean {
  const haystack = `${item.title} ${domainOf(item.url)} ${item.tags.join(' ')} ${item.summary} ${item.note} ${item.previewText}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/* ============================================================================================
 * Markdown (tiny, safe renderer: React elements only, http(s) links only)
 * ========================================================================================== */

const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) out.push(<strong key={key} className="font-semibold">{m[1]}</strong>);
    else if (m[2]) out.push(<em key={key}>{m[2]}</em>);
    else if (m[3]) out.push(<code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800">{m[3]}</code>);
    else if (m[4] && m[5])
      out.push(
        <a key={key} href={m[5]} target="_blank" rel="noopener noreferrer" className="text-[#b45f06] underline underline-offset-2 hover:text-[#8a4705] dark:text-[#fca311]">
          {m[4]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'p'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'code'; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const special = (l: string) => /^(#{1,3})\s|^>\s?|^\s*[-*]\s+|^\s*\d+\.\s+|^```/.test(l);
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '');
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'h', level: (heading[1] ?? '#').length as 1 | 2 | 3, text: heading[2] ?? '' });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) q.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: q.join(' ') });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) items.push((lines[i++] ?? '').replace(/^\s*[-*]\s+/, ''));
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) items.push((lines[i++] ?? '').replace(/^\s*\d+\.\s+/, ''));
      blocks.push({ type: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() && !special(lines[i] ?? '')) para.push((lines[i++] ?? '').trim());
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source]);
  return (
    <div className={cx('space-y-2 text-sm leading-relaxed', className)}>
      {blocks.map((b, idx) => {
        const key = `b${idx}`;
        switch (b.type) {
          case 'h':
            return (
              <p key={key} className={cx('font-semibold text-slate-900 dark:text-slate-100', b.level === 1 ? 'text-base' : b.level === 2 ? 'text-[0.95rem]' : 'text-sm')}>
                {renderInline(b.text, key)}
              </p>
            );
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-[#fca311] pl-3 italic text-slate-600 dark:text-slate-300">
                {renderInline(b.text, key)}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>)}
              </ol>
            );
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
                <code>{b.text}</code>
              </pre>
            );
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}

/* ============================================================================================
 * Mock data (titles are real public pages; summaries, notes and highlights are illustrative)
 * ========================================================================================== */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

const MOCK_COLLECTIONS: Collection[] = [
  { id: 'c-frontend', name: 'Frontend craft' },
  { id: 'c-reading', name: 'Reading list' },
  { id: 'c-money', name: 'Money & markets' },
  { id: 'c-work', name: 'Work playbook' },
];

function mk(partial: Partial<BookmarkItem> & Pick<BookmarkItem, 'url' | 'title' | 'tags' | 'summary' | 'previewText'>): BookmarkItem {
  return {
    id: uid(),
    highlights: [],
    note: '',
    reminder: null,
    collectionId: null,
    inbox: false,
    archived: false,
    savedAt: ago(DAY),
    readingMins: 6,
    ...partial,
  };
}

const MOCK_BOOKMARKS: BookmarkItem[] = [
  mk({
    url: 'https://react.dev/learn/thinking-in-react',
    title: 'Thinking in React',
    tags: ['react', 'components', 'state', 'frontend'],
    summary: 'Walks through turning a design mockup into a React app: split the UI into components, build a static version, then add state. A useful mental model for structuring any interface.',
    previewText: 'React can change how you think about the designs you look at and the apps you build. When you build a user interface with React, you will first break it apart into pieces called components. Then, you will describe the different visual states for each of your components. Finally, you will connect your components together so that the data flows through them.',
    highlights: ['Find the minimal but complete representation of UI state.'],
    note: '## Takeaways\n- Start from the **mockup**, draw boxes, name them\n- Build the static version first, *no state yet*\n- Keep state as small as possible\n\n> Revisit before the next refactor.',
    collectionId: 'c-frontend',
    savedAt: ago(2 * DAY),
    readingMins: 12,
    reminder: { at: ahead(18 * HOUR), repeat: 'weekly', push: true, email: false },
  }),
  mk({
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
    title: 'CSS grid layout',
    tags: ['css', 'grid', 'layout', 'frontend'],
    summary: 'Reference for the two-dimensional layout system in CSS, covering grid containers, tracks, areas and alignment. Handy when you need rows and columns to work together.',
    previewText: 'CSS grid layout excels at dividing a page into major regions or defining the relationship in terms of size, position, and layer between parts of a control built from HTML primitives. Like tables, grid layout enables an author to align elements into columns and rows.',
    collectionId: 'c-frontend',
    savedAt: ago(5 * DAY),
    readingMins: 9,
  }),
  mk({
    url: 'https://tailwindcss.com/docs/styling-with-utility-classes',
    title: 'Styling with utility classes',
    tags: ['tailwind', 'css', 'utility-first', 'design-systems'],
    summary: 'Explains the utility-first approach: compose designs from small single-purpose classes instead of writing custom CSS. Covers hover and responsive variants and when to extract components.',
    previewText: 'You style things with Tailwind by combining many single-purpose presentational classes directly in your markup. Building complex components from a constrained set of primitive utilities keeps your styles consistent and your stylesheet from growing.',
    collectionId: 'c-frontend',
    savedAt: ago(9 * DAY),
    readingMins: 7,
  }),
  mk({
    url: 'https://web.dev/articles/vitals',
    title: 'Web Vitals',
    tags: ['performance', 'core-web-vitals', 'seo', 'frontend'],
    summary: 'Introduces Google’s Core Web Vitals, the metrics for loading, interactivity and visual stability. Use them as a shared yardstick for page experience.',
    previewText: 'Optimizing for quality of user experience is key to the long-term success of any site on the web. Web Vitals is an initiative to provide unified guidance for quality signals that are essential to delivering a great user experience on the web.',
    highlights: ['Largest Contentful Paint measures loading performance.'],
    collectionId: 'c-frontend',
    savedAt: ago(12 * DAY),
    readingMins: 8,
    reminder: { at: ago(26 * HOUR), repeat: 'once', push: true, email: true },
  }),
  mk({
    url: 'https://github.com/vercel/next.js',
    title: 'vercel/next.js: The React Framework',
    tags: ['nextjs', 'react', 'ssr', 'framework'],
    summary: 'Source repository for Next.js, a React framework for production apps with routing, server rendering and data fetching built in. Worth watching the releases for upgrade notes.',
    previewText: 'Next.js is a React framework for building full-stack web applications. You use React Components to build user interfaces, and Next.js for additional features and optimizations.',
    inbox: true,
    savedAt: ago(25 * MIN),
    readingMins: 4,
  }),
  mk({
    url: 'https://paulgraham.com/greatwork.html',
    title: 'How to Do Great Work',
    tags: ['career', 'curiosity', 'essays', 'productivity'],
    summary: 'A long essay on how people end up doing great work: follow your curiosity, work hard on questions that fascinate you, and keep moving toward the frontier. Better read slowly, in one sitting.',
    previewText: 'If you collected lists of techniques for doing great work in a lot of different fields, what would the intersection look like? I decided to find out by making it. Here is the list. Choose a field, learn enough to get to the frontier, notice gaps, and explore promising ones.',
    highlights: ['The way to figure out what to work on is by working.'],
    note: 'Re-read **section 3** with the team. Link: [the essay](https://paulgraham.com/greatwork.html)',
    collectionId: 'c-reading',
    savedAt: ago(16 * DAY),
    readingMins: 45,
  }),
  mk({
    url: 'https://www.nngroup.com/articles/ten-usability-heuristics/',
    title: '10 Usability Heuristics for User Interface Design',
    tags: ['ux', 'usability', 'heuristics', 'design'],
    summary: 'The classic list of ten broad rules of thumb for interaction design, from visibility of system status to error prevention. A quick checklist for reviewing any interface.',
    previewText: 'Jakob Nielsen’s 10 general principles for interaction design. They are called heuristics because they are broad rules of thumb and not specific usability guidelines.',
    inbox: true,
    savedAt: ago(3 * HOUR),
    readingMins: 10,
  }),
  mk({
    url: 'https://www.refactoringui.com/',
    title: 'Refactoring UI',
    tags: ['ui-design', 'visual-hierarchy', 'typography', 'design'],
    summary: 'A guide for developers on making interfaces look better without a designer, with practical advice on hierarchy, spacing, colour and depth. Aimed at people who build UIs for a living.',
    previewText: 'Learn how to design beautiful user interfaces by yourself using specific tactics explained from a developer’s point of view.',
    collectionId: 'c-frontend',
    savedAt: ago(20 * DAY),
    readingMins: 5,
  }),
  mk({
    url: 'https://www.investopedia.com/terms/i/indexfund.asp',
    title: 'Index Fund: What It Is and How to Invest',
    tags: ['index-funds', 'investing', 'etf', 'personal-finance'],
    summary: 'Explains how index funds track a market benchmark, why their fees are usually low, and what to weigh before buying one. A good primer for long-term, hands-off investing.',
    previewText: 'An index fund is a type of mutual fund or exchange-traded fund with a portfolio constructed to match or track the components of a financial market index. Index funds are known for low fees and broad market exposure.',
    note: '- Compare expense ratios\n- Decide on monthly amount\n- Automate it',
    collectionId: 'c-money',
    savedAt: ago(7 * DAY),
    readingMins: 8,
    reminder: { at: ahead(6 * DAY), repeat: 'monthly', push: true, email: true },
  }),
  mk({
    url: 'https://docs.stripe.com/payments/accept-a-payment',
    title: 'Accept a payment',
    tags: ['stripe', 'payments', 'api', 'checkout'],
    summary: 'Step-by-step guide to taking a payment with Stripe, from creating the payment on the server to confirming it on the client. Use it as the checklist for the billing integration.',
    previewText: 'Securely accept payments online. Build a custom payment flow with Stripe’s prebuilt UI components and server-side APIs, and handle the confirmation events on your backend.',
    collectionId: 'c-work',
    savedAt: ago(4 * DAY),
    readingMins: 15,
    reminder: { at: ahead(2 * HOUR), repeat: 'once', push: true, email: false },
  }),
  mk({
    url: 'https://linear.app/method',
    title: 'The Linear Method',
    tags: ['product-management', 'workflows', 'planning', 'productivity'],
    summary: 'A set of practices for building software with focus: write clear specs, plan in cycles and keep the backlog small. Useful ideas for tightening the team’s planning rhythm.',
    previewText: 'The Linear Method is how we work. A set of principles and practices for modern product development: build with purpose, set direction, and keep momentum.',
    inbox: true,
    savedAt: ago(70 * MIN),
    readingMins: 20,
  }),
  mk({
    url: 'https://fs.blog/mental-models/',
    title: 'Mental Models: The Best Way to Make Intelligent Decisions',
    tags: ['mental-models', 'decision-making', 'thinking', 'learning'],
    summary: 'Introduces mental models as compact ways to understand how the world works and to make better decisions. Starts with the basics and links to detailed guides on individual models.',
    previewText: 'Mental models are how we simplify complexity, why we consider some things more relevant than others, and how we reason. Learning the big ideas from many disciplines gives you a toolkit for better decisions.',
    collectionId: 'c-reading',
    savedAt: ago(30 * DAY),
    readingMins: 18,
  }),
];

/** MOCK: stands in for your scrape + tag + summarise pipeline. */
function mockEnrich(url: string): Pick<BookmarkItem, 'title' | 'tags' | 'summary' | 'previewText' | 'readingMins'> {
  const domain = domainOf(url);
  let path = '';
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch { /* ignore */ }
  const words = path.split(/[/\-_.]+/).filter((w) => w.length > 2 && !/^(html?|php|aspx?|index|www)$/.test(w));
  const title = words.length ? words.slice(0, 6).join(' ').replace(/^./, (c) => c.toUpperCase()) : domain;
  const tags = [...new Set([...words.map(normalizeTag), normalizeTag(domain.split('.')[0] ?? domain)].filter((t) => t.length > 2))].slice(0, 4);
  return {
    title,
    tags: tags.length ? tags : ['saved'],
    summary: `A page from ${domain}${words.length ? ` about ${words.slice(0, 3).join(' ')}` : ''}. Open it to add a note, or set a reminder to come back to it.`,
    previewText: `Scraped text from ${domain} appears here once the page has been fetched.`,
    readingMins: 5,
  };
}

/* ============================================================================================
 * Chat (MOCK: replace buildAnswer with your RAG endpoint and stream the tokens)
 * ========================================================================================== */

function buildAnswer(question: string, items: BookmarkItem[]): { text: string; sources: string[] } {
  const live = items.filter((b) => !b.archived);
  if (/\b(review|remind|reminders|due|this week|revisit|next up)\b/i.test(question)) {
    const due = live
      .filter((b) => b.reminder)
      .sort((a, b) => new Date(a.reminder!.at).getTime() - new Date(b.reminder!.at).getTime())
      .slice(0, 4);
    if (!due.length) return { text: 'You have no reminders set. Open any bookmark and pick **Set reminder** to schedule a review.', sources: [] };
    return {
      text: `Here is what is coming up for review:\n\n${due.map((b, i) => `${i + 1}. **${b.title}**, ${formatDue(b.reminder!.at).label.toLowerCase()} [${i + 1}]`).join('\n')}`,
      sources: due.map((b) => b.id),
    };
  }
  const ranked = live
    .map((b) => ({ b, score: semanticScore(b, question) }))
    .filter((r) => r.score > 0.08)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  if (!ranked.length) {
    return { text: 'I could not find anything in your bookmarks about that yet. Try saving a page on the topic, or ask about something you have saved, like *React* or *index funds*.', sources: [] };
  }
  return {
    text: `Here is what your saved pages say:\n\n${ranked.map((r, i) => `${i + 1}. **${r.b.title}**: ${r.b.summary} [${i + 1}]`).join('\n')}`,
    sources: ranked.map((r) => r.b.id),
  };
}

/* ============================================================================================
 * Hooks
 * ========================================================================================== */

/** Keeps Tab inside `ref` while `active`, and returns focus to the opener afterwards. */
function useFocusTrap(ref: { current: HTMLElement | null }, active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])');
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [active, ref]);
}

/* ============================================================================================
 * Shared styles
 * ========================================================================================== */

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fca311]';
const btnBase = cx('inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50', ring);
const btnPrimary = cx(btnBase, 'bg-[#fca311] text-[#14213d] hover:bg-[#ffb23e]');
const btnSecondary = cx(btnBase, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700');
const btnDanger = cx(btnBase, 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50 dark:bg-slate-800 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/10');
const fieldCls = cx('w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700', ring);
const panel = 'rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800';
const sectionTitle = 'mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300';

/* ============================================================================================
 * Visual atoms
 * ========================================================================================== */

function Favicon({ domain, size = 20 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };
  if (failed) {
    return (
      <span
        aria-hidden="true"
        style={{ ...dim, background: `hsl(${hueOf(domain)} 55% 42%)` }}
        className="inline-flex shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase text-white"
      >
        {domain.charAt(0)}
      </span>
    );
  }
  return (
    <img
      alt=""
      style={dim}
      className="shrink-0 rounded-md bg-white object-contain ring-1 ring-slate-200 dark:ring-slate-700"
      loading="lazy"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      onError={() => setFailed(true)}
    />
  );
}

/** Cover image: the og:image when there is one, otherwise a generated cover so cards never look empty. */
function PreviewImage({ item, className }: { item: BookmarkItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(item.url);
  const hue = hueOf(domain);
  if (item.image && !failed) {
    return <img alt="" loading="lazy" src={item.image} onError={() => setFailed(true)} className={cx('h-full w-full object-cover', className)} />;
  }
  return (
    <div
      aria-hidden="true"
      className={cx('relative h-full w-full overflow-hidden', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 48) % 360} 58% 30%))` }}
    >
      <span className="absolute -right-6 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <span className="absolute -bottom-10 left-6 h-28 w-28 rounded-full bg-black/10" />
      <span className="absolute bottom-3 left-4 right-16 truncate text-xs font-medium text-white/80">{domain}</span>
      <span className="absolute -bottom-1 right-4 text-5xl font-bold uppercase leading-none text-white/25">{domain.charAt(0)}</span>
    </div>
  );
}

function TagPill({ children, onRemove }: { children: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
      <span className="truncate">#{children}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove tag ${children}`} className={cx('rounded-full p-0.5 hover:bg-amber-200/60 dark:hover:bg-amber-400/20', ring)}>
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

function AiShimmerPills() {
  return (
    <div className="flex gap-1.5" aria-label="AI is tagging this page" role="status">
      {[56, 72, 48].map((w) => (
        <span key={w} style={{ width: w }} className="h-5 animate-pulse rounded-full bg-amber-100 dark:bg-amber-400/20" />
      ))}
      <span className="ml-1 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <Sparkles className="h-3 w-3" aria-hidden="true" /> tagging…
      </span>
    </div>
  );
}

/* ============================================================================================
 * Card
 * ========================================================================================== */

interface CardProps {
  item: BookmarkItem;
  collectionName?: string;
  matchPercent?: number;
  onOpen: (id: string, focus?: DrawerFocus) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

const BookmarkCard = memo(function BookmarkCard({ item, collectionName, matchPercent, onOpen, onArchive, onDelete }: CardProps) {
  const domain = domainOf(item.url);
  const due = item.reminder ? formatDue(item.reminder.at) : null;
  const shown = pickTags(item.tags);
  const extra = item.tags.length - shown.length;

  const action = (label: string, icon: ReactNode, onClick: () => void, active = false, danger = false) => (
    <button
      type="button"
      title={label}
      aria-label={`${label}: ${item.title}`}
      onClick={onClick}
      className={cx(
        'rounded-lg p-2 transition-colors',
        ring,
        active ? 'bg-amber-100 text-[#8a4705] dark:bg-amber-400/20 dark:text-[#fca311]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
        danger && 'hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-300',
      )}
    >
      {icon}
    </button>
  );

  return (
    <article className={cx(panel, 'group flex flex-col overflow-hidden transition-shadow hover:shadow-lg hover:shadow-slate-900/5')} data-testid="bookmark-card">
      <button type="button" onClick={() => onOpen(item.id)} aria-label={`Open ${item.title}`} tabIndex={-1} className="relative block aspect-[5/2] w-full overflow-hidden text-left">
        <PreviewImage item={item} className="transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
        <span className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          {item.note.trim() && (
            <span data-testid="note-badge" className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm">
              <StickyNote className="h-3 w-3" aria-hidden="true" /> Note
            </span>
          )}
          {due && (
            <span
              data-testid="reminder-badge"
              className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shadow-sm', due.overdue ? 'bg-red-600 text-white' : 'bg-[#fca311] text-[#14213d]')}
            >
              <BellRing className="h-3 w-3" aria-hidden="true" /> {due.label}
            </span>
          )}
        </span>
        {matchPercent !== undefined && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#14213d]/90 px-2 py-0.5 text-xs font-medium text-white">
            <Sparkles className="h-3 w-3 text-[#fca311]" aria-hidden="true" /> {matchPercent}% match
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-2.5">
          <Favicon domain={domain} />
          <div className="min-w-0">
            <button type="button" onClick={() => onOpen(item.id)} className={cx('line-clamp-2 rounded text-left text-sm font-semibold leading-snug text-slate-900 hover:underline dark:text-slate-100', ring)}>
              {item.title}
            </button>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {domain}
              {collectionName ? ` · ${collectionName}` : ''} · {item.readingMins} min
            </p>
          </div>
        </div>

        {item.aiPending ? (
          <AiShimmerPills />
        ) : (
          <div className="flex flex-nowrap gap-1.5 overflow-hidden px-px py-px">
            {shown.map((t) => <TagPill key={t}>{t}</TagPill>)}
            {extra > 0 && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs text-slate-500 dark:text-slate-400">+{extra}</span>}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
          <div className="flex items-center gap-0.5">
            {action('Add note', <StickyNote className="h-4 w-4" aria-hidden="true" />, () => onOpen(item.id, 'note'), Boolean(item.note.trim()))}
            {action('Set reminder', <BellPlus className="h-4 w-4" aria-hidden="true" />, () => onOpen(item.id, 'reminder'), Boolean(item.reminder))}
            {action(item.archived ? 'Restore' : 'Archive', item.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />, () => onArchive(item.id))}
          </div>
          {action('Delete', <Trash2 className="h-4 w-4" aria-hidden="true" />, () => onDelete(item.id), false, true)}
        </div>
      </div>
    </article>
  );
});

/* ============================================================================================
 * Drawer pieces
 * ========================================================================================== */

function NoteEditor({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus: boolean }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const ref = useRef<HTMLTextAreaElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // "Saving…" -> "Saved" indicator (MOCK: your real autosave goes here, debounced)
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    setStatus('saving');
    const t = setTimeout(() => setStatus('saved'), 700);
    return () => clearTimeout(t);
  }, [value]);

  const edit = (build: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const ta = ref.current;
    if (!ta) return;
    const next = build(value, ta.selectionStart, ta.selectionEnd);
    onChange(next.text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.start, next.end);
    });
  };
  const wrap = (before: string, after: string, placeholder: string) =>
    edit((text, s, e) => {
      const selected = text.slice(s, e) || placeholder;
      return { text: text.slice(0, s) + before + selected + after + text.slice(e), start: s + before.length, end: s + before.length + selected.length };
    });
  const prefixLines = (prefix: string) =>
    edit((text, s, e) => {
      const lineStart = text.lastIndexOf('\n', s - 1) + 1;
      const block = text.slice(lineStart, e) || '';
      const changed = (block || 'item').split('\n').map((l) => prefix + l).join('\n');
      return { text: text.slice(0, lineStart) + changed + text.slice(e), start: lineStart + prefix.length, end: lineStart + changed.length };
    });

  const tools: Array<{ label: string; icon: ReactNode; run: () => void }> = [
    { label: 'Heading', icon: <Heading2 className="h-4 w-4" aria-hidden="true" />, run: () => prefixLines('## ') },
    { label: 'Bold', icon: <Bold className="h-4 w-4" aria-hidden="true" />, run: () => wrap('**', '**', 'bold text') },
    { label: 'Italic', icon: <Italic className="h-4 w-4" aria-hidden="true" />, run: () => wrap('*', '*', 'italic text') },
    { label: 'Bulleted list', icon: <List className="h-4 w-4" aria-hidden="true" />, run: () => prefixLines('- ') },
    { label: 'Quote', icon: <Quote className="h-4 w-4" aria-hidden="true" />, run: () => prefixLines('> ') },
    { label: 'Inline code', icon: <Code className="h-4 w-4" aria-hidden="true" />, run: () => wrap('`', '`', 'code') },
    { label: 'Link', icon: <Link2 className="h-4 w-4" aria-hidden="true" />, run: () => wrap('[', '](https://)', 'link text') },
  ];

  return (
    <div className={cx(panel, 'overflow-hidden')}>
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
        <div className="flex gap-0.5" role="tablist" aria-label="Note editor mode">
          {([['write', 'Write', Pencil], ['preview', 'Preview', Eye]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', ring, tab === id ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100')}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <span className="pr-1 text-xs text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden="true" /> Saved</span> : 'Markdown supported'}
        </span>
      </div>
      {tab === 'write' ? (
        <>
          <div className="flex flex-wrap gap-0.5 border-b border-slate-100 px-2 py-1 dark:border-slate-800">
            {tools.map((t) => (
              <button key={t.label} type="button" title={t.label} aria-label={t.label} onClick={t.run} className={cx('rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100', ring)}>
                {t.icon}
              </button>
            ))}
          </div>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            aria-label="Note (Markdown)"
            placeholder={'Write your thoughts…\n\n## Key points\n- What matters here?\n- What will you do with it?'}
            className={cx('block w-full resize-y border-0 bg-transparent px-3 py-2.5 font-mono text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 dark:text-slate-100', ring)}
          />
        </>
      ) : (
        <div className="min-h-[12rem] px-3 py-3" data-testid="note-preview">
          {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}

function ReminderScheduler({ reminder, onSet, onClear }: { reminder: Reminder | null; onSet: (r: Reminder) => void; onClear: () => void }) {
  const [editing, setEditing] = useState(!reminder);
  const [value, setValue] = useState(() => toLocalInputValue(reminder ? new Date(reminder.at) : presetDate('tomorrow')));
  const [repeat, setRepeat] = useState<Reminder['repeat']>(reminder?.repeat ?? 'once');
  const [push, setPush] = useState(reminder?.push ?? true);
  const [email, setEmail] = useState(reminder?.email ?? false);
  const [now] = useState(() => toLocalInputValue(new Date()));

  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime()) && date.getTime() > Date.now() && (push || email);
  const presets: Array<{ kind: PresetKind; label: string }> = [
    { kind: 'tomorrow', label: 'Tomorrow' },
    { kind: 'weekend', label: 'This weekend' },
    { kind: 'monday', label: 'Next Monday' },
    { kind: 'month', label: 'In a month' },
  ];
  const repeatLabel = { once: 'One time', weekly: 'Weekly review', monthly: 'Monthly review' } as const;

  if (reminder && !editing) {
    const due = formatDue(reminder.at);
    return (
      <div className={cx(panel, 'flex items-start justify-between gap-3 p-3.5')} data-testid="reminder-summary">
        <div className="flex gap-3">
          <span className={cx('mt-0.5 rounded-lg p-2', due.overdue ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'bg-amber-100 text-[#8a4705] dark:bg-amber-400/15 dark:text-[#fca311]')}>
            <BellRing className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">{due.label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {repeatLabel[reminder.repeat]} · {[reminder.push && 'Push', reminder.email && 'Email'].filter(Boolean).join(' + ')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => setEditing(true)} className={cx(btnSecondary, 'px-2.5 py-1.5 text-xs')}>Change</button>
          <button type="button" onClick={onClear} className={cx(btnSecondary, 'px-2.5 py-1.5 text-xs')}>Clear</button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx(panel, 'space-y-3 p-3.5')}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick times">
        {presets.map((p) => {
          const d = presetDate(p.kind);
          const selected = toLocalInputValue(d) === value;
          return (
            <button
              key={p.kind}
              type="button"
              aria-pressed={selected}
              onClick={() => setValue(toLocalInputValue(d))}
              className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors', ring, selected ? 'bg-[#14213d] text-white ring-[#14213d]' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700')}
            >
              {p.label}
              <span className="ml-1 font-normal opacity-70">{timeFmt.format(d)}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="mb-1 flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Date and time</span>
          <input type="datetime-local" value={value} min={now} onChange={(e) => setValue(e.target.value)} className={fieldCls} />
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="mb-1 flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Repeat</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Reminder['repeat'])} className={fieldCls}>
            <option value="once">One time</option>
            <option value="weekly">Weekly review</option>
            <option value="monthly">Monthly review</option>
          </select>
        </label>
      </div>

      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">Notify me by</legend>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Notify by</span>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="h-4 w-4 rounded accent-[#fca311]" /> Push</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4 rounded accent-[#fca311]" /> Email</label>
      </fieldset>

      {!valid && <p className="text-xs text-red-600 dark:text-red-300" role="alert">Pick a time in the future and at least one way to be notified.</p>}

      <div className="flex justify-end gap-2">
        {reminder && <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>Cancel</button>}
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onSet({ at: date.toISOString(), repeat, push, email });
            setEditing(false);
          }}
          className={btnPrimary}
        >
          <Bell className="h-4 w-4" aria-hidden="true" /> {reminder ? 'Update reminder' : 'Set reminder'}
        </button>
      </div>
    </div>
  );
}

function AiSummary({ item, onRegenerate }: { item: BookmarkItem; onRegenerate: () => void }) {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const regenerate = () => {
    setBusy(true);
    timer.current = setTimeout(() => {
      onRegenerate();
      setBusy(false);
    }, 900); // MOCK: call your summarisation endpoint here
  };

  return (
    <div className="rounded-xl bg-gradient-to-br from-[#14213d] to-[#1f3157] p-4 text-white ring-1 ring-[#14213d]">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#fca311]">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> AI summary (TL;DR)
        </span>
        <button type="button" onClick={regenerate} disabled={busy} className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-60', ring)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          {busy ? 'Thinking…' : 'Regenerate'}
        </button>
      </div>
      {item.aiPending || busy ? (
        <div className="space-y-2" aria-busy="true" role="status">
          <span className="block h-3 w-full animate-pulse rounded bg-white/20" />
          <span className="block h-3 w-5/6 animate-pulse rounded bg-white/20" />
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-slate-100" data-testid="ai-summary">{item.summary}</p>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = normalizeTag(draft);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => <TagPill key={t} onRemove={() => onChange(tags.filter((x) => x !== t))}>{t}</TagPill>)}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        aria-label="Add a tag"
        placeholder="+ add tag"
        className={cx('w-24 rounded-full border-0 bg-transparent px-2 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 dark:text-slate-200', ring)}
      />
    </div>
  );
}

/* ============================================================================================
 * Drawer
 * ========================================================================================== */

interface DrawerProps {
  item: BookmarkItem;
  open: boolean;
  focus: DrawerFocus;
  collections: Collection[];
  onClose: () => void;
  onChange: (patch: Partial<BookmarkItem>) => void;
  onArchive: () => void;
  onDelete: () => void;
}

function Drawer({ item, open, focus, collections, onClose, onChange, onArchive, onDelete }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const reminderRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const domain = domainOf(item.url);
  const titleId = `drawer-title-${item.id}`;

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    if (focus === 'note') noteRef.current?.scrollIntoView({ block: 'center' });
    else if (focus === 'reminder') reminderRef.current?.scrollIntoView({ block: 'center' });
    else closeRef.current?.focus();
  }, [open, focus]);

  const regenerate = () => {
    const sentences = item.previewText.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [];
    onChange({ summary: sentences.slice(0, 2).join(' ') || item.summary }); // MOCK
  };

  const previewShort = item.previewText.length > 240 && !expanded ? `${item.previewText.slice(0, 240).trimEnd()}…` : item.previewText;

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div
        onClick={onClose}
        aria-hidden="true"
        className={cx('absolute inset-0 bg-slate-900/50 transition-opacity duration-200 motion-reduce:transition-none', open ? 'opacity-100' : 'opacity-0')}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="drawer"
        className={cx(
          'absolute inset-y-0 right-0 flex w-full flex-col bg-slate-50 shadow-2xl transition-transform duration-200 motion-reduce:transition-none dark:bg-slate-950 sm:max-w-xl lg:max-w-2xl',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <Favicon domain={domain} size={28} />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">{item.title}</h2>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-[#b45f06] hover:underline dark:text-[#fca311]">
              <span className="truncate">{item.url}</span> <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close panel" className={cx('rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800', ring)}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section aria-label="Details" className="space-y-3">
            <div className="h-24 overflow-hidden rounded-xl ring-1 ring-slate-200 sm:h-28 dark:ring-slate-800">
              <PreviewImage item={item} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Saved</dt>
                <dd>{relativeSaved(item.savedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Reading time</dt>
                <dd className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> {item.readingMins} min</dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs text-slate-500 dark:text-slate-400"><label htmlFor={`coll-${item.id}`}>Collection</label></dt>
                <dd>
                  <select
                    id={`coll-${item.id}`}
                    value={item.collectionId ?? ''}
                    onChange={(e) => onChange({ collectionId: e.target.value || null, inbox: e.target.value ? false : item.inbox })}
                    className={cx(fieldCls, 'py-1')}
                  >
                    <option value="">No collection{item.inbox ? ' (Inbox)' : ''}</option>
                    {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </dd>
              </div>
            </dl>
            <div>
              <h3 className={sectionTitle}><TagIcon className="h-3.5 w-3.5" aria-hidden="true" /> AI tags</h3>
              {item.aiPending ? <AiShimmerPills /> : <TagEditor tags={item.tags} onChange={(tags) => onChange({ tags })} />}
            </div>
          </section>

          <section aria-label="AI summary"><AiSummary item={item} onRegenerate={regenerate} /></section>

          <section aria-label="Note" ref={noteRef}>
            <h3 className={sectionTitle}><StickyNote className="h-3.5 w-3.5" aria-hidden="true" /> Note</h3>
            <NoteEditor key={item.id} value={item.note} onChange={(note) => onChange({ note })} autoFocus={open && focus === 'note'} />
          </section>

          <section aria-label="Reminder" ref={reminderRef}>
            <h3 className={sectionTitle}><BellRing className="h-3.5 w-3.5" aria-hidden="true" /> Reminder and review schedule</h3>
            <ReminderScheduler key={`${item.id}-${item.reminder?.at ?? 'none'}`} reminder={item.reminder} onSet={(reminder) => onChange({ reminder })} onClear={() => onChange({ reminder: null })} />
          </section>

          <section aria-label="Saved page text">
            <h3 className={sectionTitle}>Scraped preview text</h3>
            <div className={cx(panel, 'p-3.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300')}>
              <p>{previewShort}</p>
              {item.previewText.length > 240 && (
                <button type="button" onClick={() => setExpanded((v) => !v)} className={cx('mt-2 rounded text-xs font-medium text-[#b45f06] hover:underline dark:text-[#fca311]', ring)}>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
            {item.highlights.length > 0 && (
              <div className="mt-3">
                <h3 className={sectionTitle}><Highlighter className="h-3.5 w-3.5" aria-hidden="true" /> Highlights</h3>
                <ul className="space-y-2">
                  {item.highlights.map((h) => (
                    <li key={h} className="rounded-lg border-l-4 border-[#fca311] bg-amber-50 px-3 py-2 text-sm text-slate-800 dark:bg-amber-400/10 dark:text-slate-100">“{h}”</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={onArchive} className={btnSecondary}>
            {item.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
            {item.archived ? 'Restore' : 'Archive'}
          </button>
          <button type="button" onClick={onDelete} className={btnDanger}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ============================================================================================
 * Sidebar
 * ========================================================================================== */

interface SidebarProps {
  view: ViewId;
  collectionId: string | null;
  tag: string | null;
  counts: Record<ViewId, number>;
  collections: Array<Collection & { count: number }>;
  topTags: Array<[string, number]>;
  onNavigate: (view: ViewId, opts?: { collectionId?: string | null; tag?: string | null }) => void;
}

function SidebarContent({ view, collectionId, tag, counts, collections, topTags, onNavigate }: SidebarProps) {
  const [open, setOpen] = useState<{ collections: boolean; tags: boolean }>({ collections: true, tags: false });

  const item = (id: ViewId, label: string, icon: ReactNode, expandKey?: 'collections' | 'tags') => {
    const active = view === id && !collectionId && !tag;
    return (
      <div>
        <div className="flex items-center">
          <button
            type="button"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => {
              onNavigate(id, { collectionId: null, tag: null });
              if (expandKey) setOpen((o) => ({ ...o, [expandKey]: true }));
            }}
            className={cx(
              'flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              ring,
              active ? 'bg-white/10 text-white' : view === id ? 'text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
            )}
          >
            <span className={cx(view === id ? 'text-[#fca311]' : 'text-slate-400')}>{icon}</span>
            <span className="flex-1 text-left">{label}</span>
            {id !== 'chat' && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-slate-200">{counts[id]}</span>}
          </button>
          {expandKey && (
            <button
              type="button"
              aria-label={`${open[expandKey] ? 'Collapse' : 'Expand'} ${label}`}
              aria-expanded={open[expandKey]}
              onClick={() => setOpen((o) => ({ ...o, [expandKey]: !o[expandKey] }))}
              className={cx('ml-1 rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white', ring)}
            >
              <ChevronRight className={cx('h-4 w-4 transition-transform motion-reduce:transition-none', open[expandKey] && 'rotate-90')} aria-hidden="true" />
            </button>
          )}
        </div>
        {expandKey === 'collections' && open.collections && (
          <ul className="ml-5 mt-1 space-y-0.5 border-l border-white/10 pl-3">
            {collections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onNavigate('collections', { collectionId: c.id, tag: null })}
                  className={cx('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[0.8125rem]', ring, collectionId === c.id ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}
                >
                  <span className="flex min-w-0 items-center gap-2"><Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="truncate">{c.name}</span></span>
                  <span className="text-xs tabular-nums text-slate-400">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {expandKey === 'tags' && open.tags && (
          <ul className="ml-5 mt-1 flex flex-wrap gap-1.5 border-l border-white/10 pl-3 pt-1">
            {topTags.map(([t, n]) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => onNavigate('tags', { tag: t, collectionId: null })}
                  className={cx('rounded-full px-2 py-0.5 text-xs ring-1', ring, tag === t ? 'bg-[#fca311] text-[#14213d] ring-[#fca311]' : 'text-slate-300 ring-white/15 hover:bg-white/5 hover:text-white')}
                >
                  #{t} <span className="opacity-60">{n}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-1 px-3 py-4">
      <div className="mb-4 flex items-center gap-2 px-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fca311] text-[#14213d]"><BookmarkIcon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="text-base font-bold tracking-tight text-white">Bukmarkz</span>
      </div>
      {item('inbox', 'Inbox', <Inbox className="h-4 w-4" aria-hidden="true" />)}
      {item('all', 'All Bookmarks', <BookmarkIcon className="h-4 w-4" aria-hidden="true" />)}
      {item('reminders', 'Reminders', <BellRing className="h-4 w-4" aria-hidden="true" />)}
      {item('collections', 'Collections', <Folder className="h-4 w-4" aria-hidden="true" />, 'collections')}
      {item('tags', 'Tags', <TagIcon className="h-4 w-4" aria-hidden="true" />, 'tags')}
      {item('chat', 'AI Chat', <MessageSquare className="h-4 w-4" aria-hidden="true" />)}
      <div className="mt-auto border-t border-white/10 pt-3">
        {item('archive', 'Archive', <Archive className="h-4 w-4" aria-hidden="true" />)}
      </div>
    </nav>
  );
}

/* ============================================================================================
 * Overviews and views
 * ========================================================================================== */

function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-16 text-center dark:border-slate-700" data-testid="empty-state">
      <span className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{icon}</span>
      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</p>}
    </div>
  );
}

function CollectionsOverview({ collections, items, onPick }: { collections: Collection[]; items: BookmarkItem[]; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="collections-overview">
      {collections.map((c) => {
        const inside = items.filter((b) => b.collectionId === c.id);
        return (
          <button key={c.id} type="button" onClick={() => onPick(c.id)} className={cx(panel, 'overflow-hidden text-left transition-shadow hover:shadow-lg hover:shadow-slate-900/5', ring)}>
            <div className="grid h-24 grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-full overflow-hidden">
                  {inside[i] ? <PreviewImage item={inside[i]!} /> : <div className="h-full bg-slate-100 dark:bg-slate-800" />}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between p-3.5">
              <span className="flex items-center gap-2 text-sm font-semibold"><Folder className="h-4 w-4 text-[#b45f06] dark:text-[#fca311]" aria-hidden="true" /> {c.name}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{inside.length} bookmarks</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TagsOverview({ tags, onPick }: { tags: Array<[string, number]>; onPick: (t: string) => void }) {
  const max = Math.max(1, ...tags.map(([, n]) => n));
  return (
    <div className={cx(panel, 'flex flex-wrap items-center gap-2.5 p-5')} data-testid="tags-overview">
      {tags.map(([t, n]) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          style={{ fontSize: `${0.8 + (n / max) * 0.55}rem` }}
          className={cx('rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20 dark:hover:bg-amber-400/20', ring)}
        >
          #{t} <span className="text-xs opacity-60">{n}</span>
        </button>
      ))}
    </div>
  );
}

function ChatView({ items, onOpen }: { items: BookmarkItem[]; onOpen: (id: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>>([]);
  const byId = useMemo(() => new Map(items.map((b) => [b.id, b])), [items]);
  const busy = thinking || messages.some((m) => m.streaming);

  useEffect(() => () => timers.current.forEach((t) => { clearTimeout(t as ReturnType<typeof setTimeout>); clearInterval(t as ReturnType<typeof setInterval>); }), []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, thinking]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { id: uid(), role: 'user', text: q }]);
    setDraft('');
    setThinking(true);
    const wait = setTimeout(() => {
      const { text, sources } = buildAnswer(q, items); // MOCK: call your RAG endpoint and stream
      const id = uid();
      setThinking(false);
      setMessages((m) => [...m, { id, role: 'assistant', text: '', sources: [], streaming: true }]);
      let shown = 0;
      const tick = setInterval(() => {
        shown = Math.min(text.length, shown + 7);
        const done = shown >= text.length;
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: text.slice(0, shown), streaming: !done, sources: done ? sources : [] } : x)));
        if (done) clearInterval(tick);
      }, 16);
      timers.current.push(tick);
    }, 650);
    timers.current.push(wait);
  };

  const suggestions = ['What have I saved about React?', 'Summarize my money bookmarks', 'What should I review this week?'];

  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem)] max-w-3xl flex-col" data-testid="chat-view">
      <div className="flex-1 space-y-4 overflow-y-auto pb-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 rounded-2xl bg-[#14213d] p-3 text-[#fca311]"><Bot className="h-6 w-6" aria-hidden="true" /></span>
            <p className="text-lg font-semibold">Ask your bookmarks</p>
            <p className="mb-5 mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">Answers come only from pages you have saved, with sources you can open.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className={cx(btnSecondary, 'rounded-full text-xs')}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[85%] rounded-2xl px-4 py-3', m.role === 'user' ? 'bg-[#14213d] text-white' : cx(panel, 'text-slate-800 dark:text-slate-100'))}>
              {m.role === 'user' ? <p className="text-sm">{m.text}</p> : <Markdown source={m.text || '…'} />}
              {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[#fca311] align-middle" aria-hidden="true" />}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800" data-testid="chat-sources">
                  {m.sources.map((sid, i) => {
                    const src = byId.get(sid);
                    return src ? (
                      <button key={sid} type="button" onClick={() => onOpen(sid)} className={cx('inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-1 pr-2.5 text-xs text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700', ring)}>
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#14213d] text-[10px] font-bold text-white">{i + 1}</span>
                        <span className="truncate">{src.title}</span>
                      </button>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start" role="status" aria-label="Searching your bookmarks">
            <div className={cx(panel, 'inline-flex items-center gap-2 px-4 py-3 text-sm text-slate-500 dark:text-slate-400')}>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching your bookmarks…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); ask(draft); }}
        className={cx(panel, 'flex items-end gap-2 p-2')}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
          rows={1}
          aria-label="Ask a question about your bookmarks"
          placeholder="Ask about anything you have saved…"
          className={cx('max-h-32 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm placeholder:text-slate-400', ring)}
        />
        <button type="submit" disabled={!draft.trim() || busy} aria-label="Send question" className={cx(btnPrimary, 'px-3')}>
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

/* ============================================================================================
 * Top bar and add-bookmark popover
 * ========================================================================================== */

function AddBookmarkPopover({ onAdd, onClose }: { onAdd: (url: string) => string | null; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className={cx(panel, 'absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-2 p-3 shadow-xl')}
      onSubmit={(e) => {
        e.preventDefault();
        const err = onAdd(url);
        if (err) setError(err);
        else onClose();
      }}
    >
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="add-url">Page address</label>
      <input id="add-url" ref={ref} value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://example.com/article" className={fieldCls} autoComplete="off" spellCheck={false} />
      {error && <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" /> Save</button>
      </div>
    </form>
  );
}

/* ============================================================================================
 * Main component
 * ========================================================================================== */

const VIEW_TITLES: Record<ViewId, { title: string; hint: string }> = {
  inbox: { title: 'Inbox', hint: 'Fresh saves to triage. File them in a collection or archive them.' },
  all: { title: 'All Bookmarks', hint: 'Everything you have saved.' },
  reminders: { title: 'Reminders', hint: 'Pages scheduled for review, soonest first.' },
  collections: { title: 'Collections', hint: 'Group related pages.' },
  tags: { title: 'Tags', hint: 'Created automatically by AI, editable any time.' },
  chat: { title: 'AI Chat', hint: 'Ask questions across everything you have saved.' },
  archive: { title: 'Archive', hint: 'Out of sight, still searchable by restoring.' },
};

export default function BookmarkWorkspace({ initialBookmarks = MOCK_BOOKMARKS, initialCollections = MOCK_COLLECTIONS }: BookmarkWorkspaceProps = {}) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(initialBookmarks);
  const [collections] = useState<Collection[]>(initialCollections);
  const [view, setView] = useState<ViewId>('inbox');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('semantic');
  const [sort, setSort] = useState<SortKey>('newest');
  const [drawer, setDrawer] = useState<{ id: string; open: boolean; focus: DrawerFocus } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /* ---------- toast ---------- */
  const showToast = useCallback((message: string, undo?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  /* ---------- bookmark actions ---------- */
  const patch = useCallback((id: string, changes: Partial<BookmarkItem>) => {
    setBookmarks((list) => list.map((b) => (b.id === id ? { ...b, ...changes } : b)));
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawer((d) => (d ? { ...d, open: false } : d));
    timers.current.push(setTimeout(() => setDrawer((d) => (d && !d.open ? null : d)), 220));
  }, []);

  const openDrawer = useCallback((id: string, focus: DrawerFocus = null) => {
    setDrawer({ id, open: false, focus });
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawer((d) => (d && d.id === id ? { ...d, open: true } : d))));
  }, []);

  const archive = useCallback((id: string) => {
    let wasArchived = false;
    setBookmarks((list) => list.map((b) => {
      if (b.id !== id) return b;
      wasArchived = b.archived;
      return { ...b, archived: !b.archived };
    }));
    setDrawer((d) => (d?.id === id ? null : d));
    showToast(wasArchived ? 'Restored from archive' : 'Archived', () => patch(id, { archived: wasArchived }));
  }, [patch, showToast]);

  const remove = useCallback((id: string) => {
    let removed: BookmarkItem | undefined;
    let index = 0;
    setBookmarks((list) => {
      index = list.findIndex((b) => b.id === id);
      removed = list[index];
      return list.filter((b) => b.id !== id);
    });
    setDrawer((d) => (d?.id === id ? null : d));
    showToast('Bookmark deleted', () => {
      if (removed) setBookmarks((list) => [...list.slice(0, index), removed!, ...list.slice(index)]);
    });
  }, [showToast]);

  /** Returns an error message, or null on success. */
  const addBookmark = useCallback((raw: string): string | null => {
    const text = raw.trim();
    if (!text) return 'Enter a web address.';
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    } catch {
      return 'That does not look like a web address.';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https links can be saved.';
    const id = uid();
    const base: BookmarkItem = {
      id, url: url.toString(), title: domainOf(url.toString()), summary: '', previewText: '', highlights: [], tags: [], aiPending: true,
      note: '', reminder: null, collectionId: null, inbox: true, archived: false, savedAt: new Date().toISOString(), readingMins: 5,
    };
    setBookmarks((list) => [base, ...list]);
    setView('inbox'); setCollectionId(null); setTag(null); setQuery('');
    showToast('Saved to Inbox. AI is tagging it…');
    // MOCK: your backend scrapes the page, then tags + summarises it (e.g. POST /api/bookmarks)
    timers.current.push(setTimeout(() => patch(id, { ...mockEnrich(url.toString()), aiPending: false }), 1500));
    return null;
  }, [patch, showToast]);

  /* ---------- navigation ---------- */
  const navigate = useCallback((next: ViewId, opts: { collectionId?: string | null; tag?: string | null } = {}) => {
    setView(next);
    setCollectionId(opts.collectionId ?? null);
    setTag(opts.tag ?? null);
    setQuery('');
    setMobileNav(false);
  }, []);

  const onSearchChange = (value: string) => {
    setQuery(value);
    if (value && view === 'chat') setView('all');
  };

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (drawer?.open) closeDrawer();
        else if (mobileNav) setMobileNav(false);
        else if (addOpen) setAddOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer?.open, mobileNav, addOpen, closeDrawer]);

  /* ---------- derived data ---------- */
  const live = useMemo(() => bookmarks.filter((b) => !b.archived), [bookmarks]);
  const collectionName = useMemo(() => new Map(collections.map((c) => [c.id, c.name])), [collections]);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((b) => b.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [live]);

  const counts: Record<ViewId, number> = {
    inbox: live.filter((b) => b.inbox).length,
    all: live.length,
    reminders: live.filter((b) => b.reminder).length,
    collections: collections.length,
    tags: tagCounts.length,
    chat: 0,
    archive: bookmarks.length - live.length,
  };
  const chatBadge = { ...counts, chat: 0 };

  const searching = query.trim().length > 0;
  const scores = useMemo(() => {
    if (!searching || mode !== 'semantic') return null;
    return new Map(live.map((b) => [b.id, semanticScore(b, query)]));
  }, [live, query, mode, searching]);

  const visible = useMemo(() => {
    let list: BookmarkItem[];
    if (searching) {
      list = mode === 'semantic' ? live.filter((b) => (scores?.get(b.id) ?? 0) > 0.06) : live.filter((b) => keywordMatches(b, query.trim()));
    } else if (view === 'inbox') list = live.filter((b) => b.inbox);
    else if (view === 'all') list = live;
    else if (view === 'reminders') list = live.filter((b) => b.reminder);
    else if (view === 'collections') list = collectionId ? live.filter((b) => b.collectionId === collectionId) : [];
    else if (view === 'tags') list = tag ? live.filter((b) => b.tags.includes(tag)) : [];
    else if (view === 'archive') list = bookmarks.filter((b) => b.archived);
    else list = [];

    const sorted = [...list];
    if (searching && mode === 'semantic') sorted.sort((a, b) => (scores?.get(b.id) ?? 0) - (scores?.get(a.id) ?? 0));
    else if (view === 'reminders' && !searching) sorted.sort((a, b) => new Date(a.reminder!.at).getTime() - new Date(b.reminder!.at).getTime());
    else if (sort === 'newest') sorted.sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt));
    else if (sort === 'oldest') sorted.sort((a, b) => +new Date(a.savedAt) - +new Date(b.savedAt));
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => (a.reminder ? +new Date(a.reminder.at) : Infinity) - (b.reminder ? +new Date(b.reminder.at) : Infinity));
    return sorted;
  }, [bookmarks, live, view, collectionId, tag, searching, mode, query, scores, sort]);

  const sidebarProps: SidebarProps = {
    view,
    collectionId,
    tag,
    counts: chatBadge,
    collections: collections.map((c) => ({ ...c, count: live.filter((b) => b.collectionId === c.id).length })),
    topTags: tagCounts.slice(0, 10),
    onNavigate: navigate,
  };

  const drawerItem = drawer ? bookmarks.find((b) => b.id === drawer.id) : undefined;
  const showOverview = !searching && ((view === 'collections' && !collectionId) || (view === 'tags' && !tag));
  const showGrid = searching || !(view === 'chat' || showOverview);

  const heading = searching
    ? { title: 'Search results', hint: `${visible.length} ${visible.length === 1 ? 'result' : 'results'} for “${query.trim()}” · ${mode === 'semantic' ? 'AI semantic search' : 'keyword search'}` }
    : view === 'collections' && collectionId
      ? { title: collectionName.get(collectionId) ?? 'Collection', hint: `${visible.length} bookmarks` }
      : view === 'tags' && tag
        ? { title: `#${tag}`, hint: `${visible.length} bookmarks` }
        : VIEW_TITLES[view];

  /* ---------- render ---------- */
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-white/5 bg-[#14213d] lg:block">
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* mobile sidebar */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileNav(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-[#14213d] shadow-2xl">
            <button type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation" className={cx('absolute right-2 top-3 rounded-lg p-2 text-slate-300 hover:bg-white/10', ring)}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <SidebarContent {...sidebarProps} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* top bar */}
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:flex-nowrap sm:gap-3 sm:px-6">
          <button type="button" onClick={() => setMobileNav(true)} aria-label="Open navigation" className={cx('rounded-lg p-2 text-slate-600 hover:bg-slate-200/70 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800', ring)}>
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="text-base font-bold tracking-tight lg:hidden">Bukmarkz</span>
          <div className="order-3 flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                ref={searchRef}
                id="global-search"
                type="search"
                value={query}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search titles, notes, tags…"
                aria-label="Search bookmarks"
                aria-keyshortcuts="/"
                autoComplete="off"
                className={cx('w-full rounded-lg border-0 bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 dark:bg-slate-900 dark:ring-slate-800', ring)}
              />
            </div>
            <div role="group" aria-label="Search mode" className="flex shrink-0 rounded-lg bg-slate-200/70 p-0.5 text-xs font-medium dark:bg-slate-800">
              {(['keyword', 'semantic'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cx('inline-flex items-center gap-1 rounded-md px-2.5 py-1.5', ring, mode === m ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}
                >
                  {m === 'semantic' && <Sparkles className="h-3 w-3 text-[#fca311]" aria-hidden="true" />} {m === 'semantic' ? 'AI' : 'Keyword'}
                </button>
              ))}
            </div>
          </div>
          <div className="relative order-2 ml-auto shrink-0 sm:order-none sm:ml-0">
            <button type="button" onClick={() => setAddOpen((v) => !v)} aria-expanded={addOpen} className={btnPrimary}>
              <Plus className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Add bookmark</span><span className="sm:hidden">Add</span>
            </button>
            {addOpen && <AddBookmarkPopover onAdd={addBookmark} onClose={() => setAddOpen(false)} />}
          </div>
        </header>

        {/* content */}
        <main className="px-4 py-6 sm:px-6" id="main">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              {(collectionId || tag) && !searching && (
                <button type="button" onClick={() => navigate(view)} className={cx('mb-1 inline-flex items-center gap-1 rounded text-xs font-medium text-[#b45f06] hover:underline dark:text-[#fca311]', ring)}>
                  ← All {view === 'collections' ? 'collections' : 'tags'}
                </button>
              )}
              <h1 className="text-2xl font-bold tracking-tight" data-testid="page-title">{heading.title}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="page-hint">{heading.hint}</p>
            </div>
            {showGrid && visible.length > 1 && !(searching && mode === 'semantic') && view !== 'reminders' && (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={cx(fieldCls, 'w-auto py-1.5')}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="title">Title A–Z</option>
                  <option value="due">Reminder soonest</option>
                </select>
              </label>
            )}
          </div>

          {view === 'chat' && !searching && <ChatView items={bookmarks} onOpen={(id) => openDrawer(id)} />}
          {showOverview && view === 'collections' && (
            <CollectionsOverview collections={collections} items={live} onPick={(id) => navigate('collections', { collectionId: id })} />
          )}
          {showOverview && view === 'tags' && <TagsOverview tags={tagCounts} onPick={(t) => navigate('tags', { tag: t })} />}

          {showGrid && (
            visible.length === 0 ? (
              searching ? (
                <EmptyState icon={<Search className="h-5 w-5" aria-hidden="true" />} title="Nothing matches that search">
                  Try fewer words{mode === 'keyword' ? ', or switch to AI search to match by meaning.' : '.'}
                </EmptyState>
              ) : view === 'inbox' ? (
                <EmptyState icon={<Check className="h-5 w-5" aria-hidden="true" />} title="Inbox zero">Everything is filed. New saves from the browser extension land here.</EmptyState>
              ) : view === 'reminders' ? (
                <EmptyState icon={<BellRing className="h-5 w-5" aria-hidden="true" />} title="No reminders yet">Open a bookmark and choose Set reminder to schedule a review.</EmptyState>
              ) : view === 'archive' ? (
                <EmptyState icon={<Archive className="h-5 w-5" aria-hidden="true" />} title="Archive is empty">Archived bookmarks show up here.</EmptyState>
              ) : (
                <EmptyState icon={<BookmarkIcon className="h-5 w-5" aria-hidden="true" />} title="No bookmarks here yet">Use Add bookmark to save your first page.</EmptyState>
              )
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 min-[1400px]:grid-cols-4" data-testid="grid">
                {visible.map((b) => (
                  <BookmarkCard
                    key={b.id}
                    item={b}
                    collectionName={b.collectionId ? collectionName.get(b.collectionId) : undefined}
                    matchPercent={searching && mode === 'semantic' ? Math.round((scores?.get(b.id) ?? 0) * 100) : undefined}
                    onOpen={openDrawer}
                    onArchive={archive}
                    onDelete={remove}
                  />
                ))}
              </div>
            )
          )}
        </main>
      </div>

      {drawer && drawerItem && (
        <Drawer
          key={drawerItem.id}
          item={drawerItem}
          open={drawer.open}
          focus={drawer.focus}
          collections={collections}
          onClose={closeDrawer}
          onChange={(changes) => patch(drawerItem.id, changes)}
          onArchive={() => archive(drawerItem.id)}
          onDelete={() => remove(drawerItem.id)}
        />
      )}

      {toast && (
        <div key={toast.id} role="status" aria-live="polite" className={cx('fixed left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-xl bg-[#14213d] px-4 py-3 text-sm text-white shadow-xl ring-1 ring-white/10', view === 'chat' ? 'bottom-24' : 'bottom-4')} data-testid="toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => { toast.undo?.(); setToast(null); }}
              className={cx('rounded-md px-2 py-1 font-semibold text-[#fca311] hover:bg-white/10', ring)}
            >
              Undo
            </button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className={cx('rounded-md p-1 text-slate-300 hover:bg-white/10', ring)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
