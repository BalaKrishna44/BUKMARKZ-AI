/**
 * BukmarkzApp: authentication suite + workspace dashboard in one file.
 *
 *   <BukmarkzApp />   ->  split-screen Sign in / Create account / Magic link / Password recovery
 *                         -> (on success) cross-fades into the high-density bookmark workspace
 *                         -> (Sign out in the sidebar) cross-fades back
 *
 * Requirements: React 18+, Tailwind CSS 3.4+ (class names also valid in v4), lucide-react. Nothing else.
 *
 * DARK MODE: the auth screen is always dark. The dashboard uses Tailwind `dark:` variants, and `theme="dark"`
 * (the default) puts a `dark` class on this component's root so the two screens match. That needs the class
 * strategy:  tailwind.config.js -> darkMode: 'class'   (v4: @custom-variant dark (&:where(.dark, .dark *));)
 * With Tailwind's default `media` strategy the dashboard follows the OS instead; use theme="system" then.
 *
 * Everything is mock state. Search for "MOCK" to find the seams:
 *   - authApi (this file, section 2)  -> your sign-in, sign-up, magic link, reset and OAuth endpoints
 *   - dashboard data, enrichment, semantic search, chat, reminders (section 3)
 * Demo rules: any valid email signs in; password "wrongpass" fails; taken@example.com is already registered.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
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
  EyeOff,
  Folder,
  Heading2,
  Highlighter,
  Inbox,
  Info,
  Italic,
  Link2,
  List,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MailCheck,
  Menu,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  User,
  X,
} from 'lucide-react';

/* ============================================================================================
 * 1. SHARED
 * ========================================================================================== */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ============================================================================================
 * 2. AUTHENTICATION SUITE
 * Split screen: value proposition on the left, the auth card on the right.
 * Views: sign in, create account, forgot password, reset password. Magic link is a toggle on
 * sign in and sign up. Everything here is dark by design and does not depend on Tailwind's dark mode.
 * ========================================================================================== */

export type AuthProvider = 'password' | 'magic-link' | 'google' | 'github';

export interface AuthUser {
  name: string;
  email: string;
  provider: AuthProvider;
  /** true right after creating an account */
  isNew: boolean;
}

type AuthView = 'signin' | 'signup' | 'forgot' | 'reset';

interface AuthFailure {
  code: 'invalid_credentials' | 'email_taken';
  message: string;
}

const isAuthFailure = (e: unknown): e is AuthFailure => typeof e === 'object' && e !== null && 'code' in e && 'message' in e;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const name = local.split(/[._+-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return name || 'there';
}

/**
 * MOCK: swap each method for a real request (your Django/Knox endpoints, an auth provider, ...).
 * Demo rules: any valid email works; the password "wrongpass" fails; "taken@example.com" is already registered.
 */
const authApi = {
  async signIn(email: string, password: string): Promise<AuthUser> {
    await wait(900);
    if (password === 'wrongpass') {
      const failure: AuthFailure = { code: 'invalid_credentials', message: 'Incorrect email or password. Check them and try again.' };
      throw failure;
    }
    return { name: nameFromEmail(email), email, provider: 'password', isNew: false };
  },
  async signUp(name: string, email: string): Promise<AuthUser> {
    await wait(1100);
    if (email.trim().toLowerCase() === 'taken@example.com') {
      const failure: AuthFailure = { code: 'email_taken', message: 'An account with this email already exists.' };
      throw failure;
    }
    return { name: name.trim(), email, provider: 'password', isNew: true };
  },
  async sendMagicLink(): Promise<void> {
    await wait(900);
  },
  async sendResetLink(): Promise<void> {
    await wait(900);
  },
  async resetPassword(): Promise<void> {
    await wait(900);
  },
  async oauth(provider: 'google' | 'github'): Promise<AuthUser> {
    await wait(900);
    return provider === 'google'
      ? { name: 'Alex Morgan', email: 'alex.morgan@gmail.com', provider, isNew: false }
      : { name: 'Alex Morgan', email: 'alex@users.noreply.github.com', provider, isNew: false };
  },
};

/* ---------- validation ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return 'Enter your email address.';
  if (!EMAIL_RE.test(v)) return 'That email address doesn’t look right.';
  return null;
}

const COMMON_PASSWORDS = ['password', '12345678', '123456789', 'qwerty', 'iloveyou', 'letmein', 'admin123', 'welcome1', 'abc12345'];

interface Strength {
  /** 0 = empty, 1 = weak ... 4 = strong */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  checks: Array<{ id: string; label: string; ok: boolean }>;
  acceptable: boolean;
  reason: string;
}

export function passwordStrength(password: string, personal: string[] = []): Strength {
  const checks = [
    { id: 'len', label: 'At least 8 characters', ok: password.length >= 8 },
    { id: 'case', label: 'Upper and lower case', ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { id: 'num', label: 'A number', ok: /\d/.test(password) },
    { id: 'sym', label: 'A symbol', ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const lower = password.toLowerCase();
  const guessable =
    password.length > 0 &&
    (COMMON_PASSWORDS.some((c) => lower.includes(c)) || /^(.)\1+$/.test(password) || personal.some((p) => p.trim().length >= 3 && lower.includes(p.trim().toLowerCase())));

  let points = Math.min(4, checks.filter((c) => c.ok).length + (password.length >= 12 ? 1 : 0));
  if (!checks[0]!.ok) points = Math.min(points, 1);
  if (guessable) points = Math.min(points, 1);
  const score = (password ? Math.max(1, points) : 0) as Strength['score'];

  const label = !password ? '' : guessable ? 'Too easy to guess' : !checks[0]!.ok ? 'Too short' : (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  const acceptable = checks[0]!.ok && !guessable && score >= 2;
  const reason = !checks[0]!.ok
    ? 'Use at least 8 characters.'
    : guessable
      ? 'That password is easy to guess. Avoid common words, and your name or email.'
      : 'Make it stronger: mix upper and lower case, numbers and symbols.';
  return { score, label, checks, acceptable, reason };
}

/* ---------- small hooks ---------- */

/** true until the component unmounts: stops late mock responses from updating a gone form */
function useAlive() {
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return alive;
}

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const restart = useCallback(() => setLeft(seconds), [seconds]);
  return [left, restart] as const;
}

/** onMouseDown handler: keep focus where it is, so a validation message does not shift the layout under the click. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/* ---------- styles ---------- */

const authRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fca311]';
const authBtn = cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60', authRing);
const authBtnPrimary = cx(authBtn, 'bg-[#fca311] text-[#14213d] shadow-[0_8px_24px_-8px_rgba(252,163,17,0.55)] hover:bg-[#ffb23e]');
const authBtnGhost = cx(authBtn, 'bg-white/[0.04] text-slate-100 ring-1 ring-white/10 hover:bg-white/[0.08]');
const authLink = cx('rounded font-medium text-[#fca311] hover:underline underline-offset-2', authRing);
const inputCls = (hasError: boolean) =>
  cx(
    'block w-full rounded-lg border-0 bg-white/[0.04] py-2.5 pl-10 pr-3 text-sm text-slate-100 ring-1 transition placeholder:text-slate-500 focus:outline-none focus:ring-2',
    hasError ? 'ring-red-400/60 focus:ring-red-400' : 'ring-white/10 focus:ring-[#fca311]/80',
  );

/* ---------- brand icons ---------- */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cx('flex items-center justify-center rounded-xl bg-[#fca311] text-[#14213d] shadow-[0_0_24px_-4px_rgba(252,163,17,0.7)]', size === 'lg' ? 'h-10 w-10' : 'h-8 w-8')}>
        <BookmarkIcon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
      </span>
      <span className={cx('font-bold tracking-tight text-white', size === 'lg' ? 'text-xl' : 'text-base')}>
        Bukmarkz <span className="text-[#fca311]">AI</span>
      </span>
    </div>
  );
}

/* ---------- left side: showcase ---------- */

/** Grid lines, drifting glows, a light beam and pulsing nodes on the grid intersections. Purely decorative. */
function GlowGrid() {
  const cell = 56;
  // [column, row, delay]. Kept to the top band and the right edge so a glowing node never sits behind text.
  const nodes: Array<[number, number, number]> = [[8, 1, 0], [11, 2, 1.4], [12, 4, 2.6], [11, 6, 0.8], [13, 9, 3.2], [12, 12, 1.9]];
  const mask = 'radial-gradient(ellipse 85% 75% at 40% 45%, #000 20%, transparent 82%)';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.075) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.075) 1px, transparent 1px)',
          backgroundSize: `${cell}px ${cell}px`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
      <div className="bk-glow-a absolute -left-28 -top-28 h-[30rem] w-[30rem] rounded-full bg-[#fca311]/20 blur-3xl" />
      <div className="bk-glow-b absolute -bottom-40 -right-10 h-[32rem] w-[32rem] rounded-full bg-sky-500/15 blur-3xl" />
      <div className="bk-beam absolute left-0 top-[34%] h-px w-2/3 bg-gradient-to-r from-transparent via-[#fca311]/30 to-transparent" />
      {nodes.map(([x, y, delay]) => (
        <span
          key={`${x}-${y}`}
          className="bk-node absolute h-1.5 w-1.5 rounded-full bg-[#fca311]"
          style={{ left: x * cell - 3, top: y * cell - 3, animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}

// PLACEHOLDER COPY: replace with real, permissioned customer quotes before launch.
const TESTIMONIALS = [
  { quote: 'I stopped re-googling things. I describe what I remember about a page and it shows up, with my own notes right next to it.', name: 'Priya N.', role: 'Staff engineer' },
  { quote: 'The reminders changed how I read. I save it, pick a day, and the page comes back when I actually have time for it.', name: 'Marcus T.', role: 'Product designer' },
  { quote: 'Tags and summaries are there before I have closed the tab. Triage takes minutes instead of piling up for months.', name: 'Elena R.', role: 'Research lead' },
];

function Testimonials() {
  const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(reducedMotion);
  const [engaged, setEngaged] = useState(false); // pointer over, or keyboard focus inside
  const running = !paused && !engaged;

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % TESTIMONIALS.length), 6000);
    return () => clearInterval(t);
  }, [running]);

  const current = TESTIMONIALS[index]!;
  return (
    <figure
      className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 backdrop-blur"
      aria-roledescription="carousel"
      aria-label="What people say"
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
    >
      <div key={index} className="bk-fade-up min-h-[7.5rem]" aria-live={running ? 'off' : 'polite'} data-testid="testimonial">
        <blockquote className="text-[0.95rem] leading-relaxed text-slate-200">“{current.quote}”</blockquote>
        <figcaption className="mt-3 flex items-center gap-2.5 text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fca311]/15 text-xs font-semibold text-[#fca311]" aria-hidden="true">{current.name.charAt(0)}</span>
          <span className="font-medium text-white">{current.name}</span>
          <span className="text-slate-400">{current.role}</span>
        </figcaption>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5" role="group" aria-label="Choose testimonial">
          {TESTIMONIALS.map((t, i) => (
            <button
              key={t.name}
              type="button"
              aria-label={`Show testimonial ${i + 1} of ${TESTIMONIALS.length}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cx('h-1.5 rounded-full transition-all', authRing, i === index ? 'w-6 bg-[#fca311]' : 'w-1.5 bg-white/25 hover:bg-white/40')}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? 'Resume testimonial rotation' : 'Pause testimonial rotation'}
          className={cx('rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white', authRing)}
        >
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>
    </figure>
  );
}

const SHOWCASE_FEATURES = [
  { icon: Sparkles, title: 'AI tags and a TL;DR on every save', body: 'Pages are tagged and summarized as you save them.' },
  { icon: StickyNote, title: 'Notes and highlights beside the page', body: 'Write in Markdown, right next to what you saved.' },
  { icon: BellRing, title: 'Reminders that bring you back', body: 'Schedule a review and get a push or an email.' },
  { icon: Search, title: 'Search by meaning, or just ask', body: 'Find pages by idea, or chat with your library.' },
] as const;

function AuthShowcase() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/5 bg-[#070b14] p-10 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[52%] xl:w-[55%] xl:p-14">
      <GlowGrid />
      <div className="relative"><BrandMark size="lg" /></div>

      <div className="relative max-w-xl">
        <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white xl:text-5xl">Your reading, remembered.</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
          Bukmarkz AI turns saved pages into a workspace you can search: tagged, summarized, annotated, and brought back to you on schedule.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {SHOWCASE_FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#fca311] ring-1 ring-white/10"><Icon className="h-4 w-4" aria-hidden="true" /></span>
              <span>
                <span className="block text-sm font-semibold text-white">{title}</span>
                <span className="block text-sm text-slate-400">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative max-w-xl"><Testimonials /></div>
    </aside>
  );
}

/* ---------- form atoms ---------- */

interface AuthFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  icon: ReactNode;
  type?: string;
  error?: string;
  hint?: ReactNode;
  labelAction?: ReactNode;
  right?: ReactNode;
  autoComplete?: string;
  placeholder?: string;
  inputMode?: 'email' | 'text';
  inputRef?: { current: HTMLInputElement | null };
  onKeyEvent?: (e: { getModifierState?: (key: string) => boolean }) => void;
}

function AuthField({ id, label, value, onChange, onBlur, icon, type = 'text', error, hint, labelAction, right, autoComplete, placeholder, inputMode, inputRef, onKeyEvent }: AuthFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-slate-200">{label}</label>
        {labelAction}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>
        <input
          id={id}
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyUp={onKeyEvent}
          onKeyDown={onKeyEvent}
          autoComplete={autoComplete}
          placeholder={placeholder}
          inputMode={inputMode}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(inputCls(Boolean(error)), right && 'pr-11')}
        />
        {right && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{right}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-red-300">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

function PasswordField({ id, label, value, onChange, onBlur, error, autoComplete, labelAction, placeholder, inputRef, children }: Omit<AuthFieldProps, 'icon' | 'right' | 'type' | 'hint'> & { children?: ReactNode }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <AuthField
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        onBlur={() => { setCaps(false); onBlur?.(); }}
        type={show ? 'text' : 'password'}
        icon={<Lock className="h-4 w-4" aria-hidden="true" />}
        error={error}
        hint={caps ? <span className="text-amber-300">Caps Lock is on.</span> : undefined}
        labelAction={labelAction}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputRef={inputRef}
        onKeyEvent={(e) => setCaps(Boolean(e.getModifierState?.('CapsLock')))}
        right={
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className={cx('rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white', authRing)}
          >
            {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        }
      />
      {children}
    </div>
  );
}

const STRENGTH_COLORS = ['bg-white/10', 'bg-red-400', 'bg-orange-400', 'bg-yellow-300', 'bg-emerald-400'] as const;

function StrengthMeter({ strength }: { strength: Strength }) {
  if (!strength.score) return null;
  return (
    <div className="mt-2.5" data-testid="strength-meter">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cx('h-1 flex-1 rounded-full transition-colors', n <= strength.score ? STRENGTH_COLORS[strength.score] : 'bg-white/10')} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-slate-300" role="status">
        Password strength: <span className="font-semibold text-white">{strength.label}</span>
      </p>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {strength.checks.map((c) => (
          <li key={c.id} className={cx('flex items-center gap-1.5 text-xs', c.ok ? 'text-emerald-300' : 'text-slate-500')}>
            <Check className={cx('h-3 w-3', !c.ok && 'opacity-30')} aria-hidden="true" /> {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ tone, children, action }: { tone: 'error' | 'success' | 'info'; children: ReactNode; action?: ReactNode }) {
  const styles = {
    error: 'bg-red-500/10 text-red-200 ring-red-400/25',
    success: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/25',
    info: 'bg-sky-500/10 text-sky-200 ring-sky-400/25',
  } as const;
  const Icon = tone === 'success' ? Check : Info;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm ring-1', styles[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">{children}{action && <div className="mt-1">{action}</div>}</div>
    </div>
  );
}

type SubmitStatus = 'idle' | 'loading' | 'success';

function SubmitButton({ status, label, loadingLabel, successLabel }: { status: SubmitStatus; label: string; loadingLabel: string; successLabel: string }) {
  return (
    <button type="submit" disabled={status !== 'idle'} onMouseDown={keepFocus} className={cx(authBtnPrimary, 'w-full', status === 'success' && 'disabled:opacity-100')} aria-live="polite">
      {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {status === 'success' && <Check className="h-4 w-4" aria-hidden="true" />}
      {status === 'idle' ? label : status === 'loading' ? loadingLabel : successLabel}
    </button>
  );
}

function Switch({ id, checked, onChange, label, description }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/10">
      <label htmlFor={id} className="cursor-pointer">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-100"><Sparkles className="h-3.5 w-3.5 text-[#fca311]" aria-hidden="true" /> {label}</span>
        <span className="mt-0.5 block text-xs text-slate-400">{description}</span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onMouseDown={keepFocus}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', authRing, checked ? 'bg-[#fca311]' : 'bg-white/15')}
      >
        <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none', checked ? 'translate-x-5' : 'translate-x-0')} />
      </button>
    </div>
  );
}

function OAuthButtons({ busy, disabled, onPick }: { busy: 'google' | 'github' | null; disabled: boolean; onPick: (p: 'google' | 'github') => void }) {
  const items = [
    { id: 'google' as const, label: 'Google', icon: <GoogleIcon className="h-[18px] w-[18px]" /> },
    { id: 'github' as const, label: 'GitHub', icon: <GithubIcon className="h-[18px] w-[18px]" /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((p) => (
        <button key={p.id} type="button" disabled={disabled} onClick={() => onPick(p.id)} aria-label={`Continue with ${p.label}`} className={authBtnGhost}>
          {busy === p.id ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" /> : p.icon}
          {p.label}
        </button>
      ))}
    </div>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500" role="separator">
      <span className="h-px flex-1 bg-white/10" /> {children} <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

/** "Check your inbox" panel shared by magic link and password reset. */
function SentPanel({ title, email, children, onResend, onChangeEmail, changeLabel, demoLabel, onDemo }: {
  title: string; email: string; children: ReactNode; onResend: () => Promise<void>; onChangeEmail: () => void; changeLabel: string; demoLabel: string; onDemo: () => void;
}) {
  const [left, restart] = useCountdown(30);
  const [resending, setResending] = useState(false);
  const alive = useAlive();
  return (
    <div className="bk-fade-up text-center" data-testid="sent-panel">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#fca311]/15 text-[#fca311] ring-1 ring-[#fca311]/30"><MailCheck className="h-6 w-6" aria-hidden="true" /></span>
      <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{children}</p>
      <p className="mx-auto mt-3 inline-block max-w-full truncate rounded-md bg-white/[0.06] px-2.5 py-1 text-sm font-medium text-white ring-1 ring-white/10">{email}</p>
      <div className="mt-6 space-y-2.5">
        <button type="button" onClick={onDemo} className={cx(authBtnPrimary, 'w-full')}>{demoLabel}</button>
        <button type="button" onClick={onChangeEmail} className={cx(authBtnGhost, 'w-full')}>{changeLabel}</button>
      </div>
      <p className="mt-4 text-xs text-slate-400" aria-live="polite">
        Didn’t get it?{' '}
        {left > 0 ? (
          <span>Resend in {left}s</span>
        ) : (
          <button
            type="button"
            disabled={resending}
            onClick={async () => {
              setResending(true);
              await onResend();
              if (!alive.current) return;
              setResending(false);
              restart();
            }}
            className={authLink}
          >
            {resending ? 'Sending…' : 'Resend'}
          </button>
        )}
      </p>
    </div>
  );
}

/* ---------- sign in / create account ---------- */

type FieldName = 'name' | 'email' | 'password' | 'terms';

interface CredentialsFormProps {
  mode: 'signin' | 'signup';
  email: string;
  setEmail: (v: string) => void;
  notice: string | null;
  onForgot: () => void;
  onSwitch: (v: AuthView) => void;
  onSuccess: (user: AuthUser) => void;
}

function CredentialsForm({ mode, email, setEmail, notice, onForgot, onSwitch, onSuccess }: CredentialsFormProps) {
  const isSignup = mode === 'signup';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [magic, setMagic] = useState(false);
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [oauthBusy, setOauthBusy] = useState<'google' | 'github' | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const alive = useAlive();
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const strength = passwordStrength(password, [email.split('@')[0] ?? '', name]);
  const errors: Partial<Record<FieldName, string>> = {};
  if (isSignup && name.trim().length < 2) errors.name = 'Enter your full name.';
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  if (!magic) {
    if (!password) errors.password = isSignup ? 'Create a password.' : 'Enter your password.';
    else if (isSignup && !strength.acceptable) errors.password = strength.reason;
  }
  if (isSignup && !terms) errors.terms = 'Accept the terms to create an account.';
  const typed: Record<FieldName, boolean> = { name: name.length > 0, email: email.length > 0, password: password.length > 0, terms: false };
  // On blur, only complain about fields that have something in them. Empty required fields wait for submit.
  const shown = (f: FieldName) => (submitted || (touched[f] && typed[f]) ? errors[f] : undefined);
  const touch = (f: FieldName) => () => setTouched((t) => ({ ...t, [f]: true }));

  const finish = (user: AuthUser) => {
    setStatus('success');
    setTimeout(() => { if (alive.current) onSuccess(user); }, 650);
  };

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure(null);
    const first = (['name', 'email', 'password', 'terms'] as const).find((f) => errors[f]);
    if (first) {
      document.getElementById(`auth-${first}`)?.focus();
      return;
    }
    setStatus('loading');
    try {
      if (magic) {
        await authApi.sendMagicLink();
        if (!alive.current) return;
        setStatus('idle');
        setSentTo(email.trim());
      } else if (isSignup) {
        finish(await authApi.signUp(name, email.trim()));
      } else {
        finish(await authApi.signIn(email.trim(), password));
      }
    } catch (err) {
      if (!alive.current) return;
      setStatus('idle');
      setFailure(isAuthFailure(err) ? err : { code: 'invalid_credentials', message: 'Something went wrong. Try again.' });
    }
  };

  const oauth = async (provider: 'google' | 'github') => {
    setOauthBusy(provider);
    const user = await authApi.oauth(provider);
    if (!alive.current) return;
    finish({ ...user, isNew: isSignup });
  };

  if (sentTo) {
    return (
      <SentPanel
        title="Check your inbox"
        email={sentTo}
        onResend={() => authApi.sendMagicLink()}
        onChangeEmail={() => setSentTo(null)}
        changeLabel="Use a different email"
        demoLabel="Open the magic link (demo)"
        onDemo={() => onSuccess({ name: isSignup && name.trim() ? name.trim() : nameFromEmail(sentTo), email: sentTo, provider: 'magic-link', isNew: isSignup })}
      >
        We sent a one-time {isSignup ? 'sign-up' : 'sign-in'} link to your email. It works once and expires in 15 minutes.
      </SentPanel>
    );
  }

  const busy = status !== 'idle' || oauthBusy !== null;
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={isSignup ? 'Create account' : 'Sign in'}>
      {notice && <Notice tone="success">{notice}</Notice>}
      <OAuthButtons busy={oauthBusy} disabled={busy} onPick={oauth} />
      <Divider>or continue with email</Divider>

      {failure && (
        <Notice
          tone="error"
          action={failure.code === 'email_taken' ? <button type="button" onClick={() => onSwitch('signin')} className={authLink}>Sign in instead</button> : undefined}
        >
          {failure.message}
        </Notice>
      )}

      {isSignup && (
        <AuthField id="auth-name" label="Full name" value={name} onChange={setName} onBlur={touch('name')} icon={<User className="h-4 w-4" aria-hidden="true" />} autoComplete="name" placeholder="Alex Morgan" error={shown('name')} inputRef={firstRef} />
      )}
      <AuthField
        id="auth-email"
        label={isSignup ? 'Work email' : 'Email'}
        type="email"
        inputMode="email"
        value={email}
        onChange={(v) => { setEmail(v); setFailure(null); }}
        onBlur={touch('email')}
        icon={<Mail className="h-4 w-4" aria-hidden="true" />}
        autoComplete="email"
        placeholder="you@company.com"
        error={shown('email')}
        inputRef={isSignup ? undefined : firstRef}
      />

      {!magic && (
        <PasswordField
          id="auth-password"
          label="Password"
          value={password}
          onChange={(v) => { setPassword(v); setFailure(null); }}
          onBlur={touch('password')}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
          error={shown('password')}
          labelAction={!isSignup ? <button type="button" onClick={onForgot} className={cx(authLink, 'text-xs')}>Forgot password?</button> : undefined}
        >
          {isSignup && <StrengthMeter strength={strength} />}
        </PasswordField>
      )}

      <Switch
        id="auth-magic"
        checked={magic}
        onChange={(v) => { setMagic(v); setFailure(null); }}
        label="Send me a magic link"
        description={magic ? 'No password needed. We’ll email you a one-time link.' : 'Skip the password and sign in with a link sent to your email.'}
      />

      {isSignup && (
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-300">
            <input
              id="auth-terms"
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              onBlur={touch('terms')}
              aria-invalid={shown('terms') ? true : undefined}
              aria-describedby={shown('terms') ? 'auth-terms-error' : undefined}
              className="mt-0.5 h-4 w-4 rounded accent-[#fca311]"
            />
            <span>I agree to the <span className="text-white underline underline-offset-2">Terms</span> and <span className="text-white underline underline-offset-2">Privacy Policy</span>.</span>
          </label>
          {shown('terms') && (
            <p id="auth-terms-error" role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-red-300"><Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {shown('terms')}</p>
          )}
        </div>
      )}

      <SubmitButton
        status={status}
        label={magic ? 'Send magic link' : isSignup ? 'Create account' : 'Sign in'}
        loadingLabel={magic ? 'Sending link…' : isSignup ? 'Creating your workspace…' : 'Signing in…'}
        successLabel={isSignup ? 'Account created' : 'Welcome back'}
      />
    </form>
  );
}

/* ---------- forgot / reset password ---------- */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('mb-5 inline-flex items-center gap-1.5 rounded text-sm text-slate-400 hover:text-white', authRing)}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
    </button>
  );
}

function ForgotForm({ email, setEmail, onBack, onOpenResetLink }: { email: string; setEmail: (v: string) => void; onBack: () => void; onOpenResetLink: () => void }) {
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const alive = useAlive();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const error = validateEmail(email);

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) { ref.current?.focus(); return; }
    setStatus('loading');
    await authApi.sendResetLink();
    if (!alive.current) return;
    setStatus('idle');
    setSentTo(email.trim());
  };

  return (
    <div>
      <BackButton onClick={onBack} />
      {sentTo ? (
        <SentPanel
          title="Check your inbox"
          email={sentTo}
          onResend={() => authApi.sendResetLink()}
          onChangeEmail={() => setSentTo(null)}
          changeLabel="Use a different email"
          demoLabel="Open the reset link (demo)"
          onDemo={onOpenResetLink}
        >
          If an account exists for this address, a link to reset your password is on its way. It expires in 30 minutes.
        </SentPanel>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5" aria-label="Reset password">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">Reset your password</h2>
            <p className="mt-1.5 text-sm text-slate-400">Enter the email you signed up with and we’ll send you a link to choose a new password.</p>
          </div>
          <AuthField id="auth-email" label="Email" type="email" inputMode="email" value={email} onChange={setEmail} onBlur={() => setTouched(true)} icon={<Mail className="h-4 w-4" aria-hidden="true" />} autoComplete="email" placeholder="you@company.com" error={submitted || (touched && email.length > 0) ? error ?? undefined : undefined} inputRef={ref} />
          <SubmitButton status={status} label="Send reset link" loadingLabel="Sending link…" successLabel="Link sent" />
        </form>
      )}
    </div>
  );
}

function ResetForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const alive = useAlive();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const strength = passwordStrength(password);
  const passwordError = !password ? 'Create a new password.' : !strength.acceptable ? strength.reason : undefined;
  const confirmError = confirm !== password ? 'The passwords don’t match.' : undefined;

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSubmitted(true);
    if (passwordError) { ref.current?.focus(); return; }
    if (confirmError) { document.getElementById('auth-confirm')?.focus(); return; }
    setStatus('loading');
    await authApi.resetPassword();
    if (!alive.current) return;
    setStatus('success');
    setTimeout(() => { if (alive.current) onDone(); }, 700);
  };

  return (
    <div>
      <BackButton onClick={onBack} />
      <form onSubmit={submit} noValidate className="space-y-5" aria-label="Choose a new password">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Choose a new password</h2>
          <p className="mt-1.5 text-sm text-slate-400">Use something you haven’t used before.</p>
        </div>
        <PasswordField id="auth-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" error={submitted ? passwordError : undefined} inputRef={ref}>
          <StrengthMeter strength={strength} />
        </PasswordField>
        <PasswordField id="auth-confirm" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat the password" error={submitted ? confirmError : undefined} />
        <SubmitButton status={status} label="Update password" loadingLabel="Updating…" successLabel="Password updated" />
      </form>
    </div>
  );
}

/* ---------- the card and the page ---------- */

function AuthTabs({ view, onChange }: { view: 'signin' | 'signup'; onChange: (v: AuthView) => void }) {
  const tabs = [{ id: 'signin' as const, label: 'Sign in' }, { id: 'signup' as const, label: 'Create account' }];
  return (
    <div role="tablist" aria-label="Authentication mode" className="grid grid-cols-2 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10">
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`auth-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={view === t.id}
          aria-controls="auth-panel"
          tabIndex={view === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const next = t.id === 'signin' ? 'signup' : 'signin';
              onChange(next);
              requestAnimationFrame(() => document.getElementById(`auth-tab-${next}`)?.focus());
            }
          }}
          className={cx('rounded-lg px-3 py-2 text-sm font-medium transition-colors', authRing, view === t.id ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function AuthSuite({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [view, setView] = useState<AuthView>('signin');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const go = (next: AuthView) => {
    setView(next);
    if (next !== 'signin') setNotice(null);
  };

  return (
    <div className="relative flex min-h-screen bg-[#05070d] text-slate-200">
      <AuthShowcase />

      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute -top-40 right-0 h-96 w-96 rounded-full bg-[#fca311]/10 blur-3xl" />

        <div className="relative w-full max-w-[26rem]">
          <div className="mb-8 lg:hidden">
            <BrandMark size="lg" />
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Your reading, remembered.</h1>
            <p className="mt-1.5 text-sm text-slate-400">Tag, summarize, annotate and revisit everything you save.</p>
          </div>

          <div className="rounded-2xl bg-white/[0.03] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_64px_-24px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-xl sm:p-7">
            {(view === 'signin' || view === 'signup') && (
              <>
                <AuthTabs view={view} onChange={go} />
                <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${view}`} key={view} className="bk-fade-up mt-6">
                  <h2 className="text-xl font-semibold tracking-tight text-white">{view === 'signin' ? 'Welcome back' : 'Create your workspace'}</h2>
                  <p className="mb-5 mt-1.5 text-sm text-slate-400">
                    {view === 'signin' ? 'Sign in to pick up where you left off.' : 'Free to start. No credit card needed.'}
                  </p>
                  <CredentialsForm mode={view} email={email} setEmail={setEmail} notice={view === 'signin' ? notice : null} onForgot={() => go('forgot')} onSwitch={go} onSuccess={onAuthenticated} />
                </div>
                <p className="mt-6 text-center text-sm text-slate-400">
                  {view === 'signin' ? 'New to Bukmarkz AI? ' : 'Already have an account? '}
                  <button type="button" onClick={() => go(view === 'signin' ? 'signup' : 'signin')} className={authLink}>
                    {view === 'signin' ? 'Create an account' : 'Sign in'}
                  </button>
                </p>
              </>
            )}
            {view === 'forgot' && (
              <div key="forgot" className="bk-fade-up">
                <ForgotForm email={email} setEmail={setEmail} onBack={() => go('signin')} onOpenResetLink={() => go('reset')} />
              </div>
            )}
            {view === 'reset' && (
              <div key="reset" className="bk-fade-up">
                <ResetForm
                  onBack={() => go('signin')}
                  onDone={() => {
                    setView('signin');
                    setNotice('Password updated. Sign in with your new password.');
                  }}
                />
              </div>
            )}
          </div>

          <p className="mt-4 rounded-lg px-3 py-2 text-center text-xs leading-relaxed text-slate-500 ring-1 ring-white/5" data-testid="demo-hint">
            Demo mode: any valid email works. The password <code className="text-slate-300">wrongpass</code> shows an error, and <code className="text-slate-300">taken@example.com</code> shows an existing-account error.
          </p>
        </div>

        <footer className="relative mt-8 flex gap-4 text-xs text-slate-500">
          <span>© Bukmarkz AI</span>
          <button type="button" className={cx('rounded hover:text-slate-300', authRing)}>Terms</button>
          <button type="button" className={cx('rounded hover:text-slate-300', authRing)}>Privacy</button>
          <button type="button" className={cx('rounded hover:text-slate-300', authRing)}>Help</button>
        </footer>
      </main>
    </div>
  );
}


/* ============================================================================================
 * 3. WORKSPACE DASHBOARD
 * ========================================================================================== */

/* ---------- Types ---------- */

type ViewId = 'inbox' | 'all' | 'reminders' | 'collections' | 'tags' | 'chat' | 'archive';
type SearchMode = 'keyword' | 'semantic';
type SortKey = 'newest' | 'oldest' | 'title' | 'due';
type DrawerFocus = 'note' | 'reminder' | null;

interface Reminder {
  /** ISO timestamp */
  at: string;
  repeat: 'once' | 'weekly' | 'monthly';
  push: boolean;
  email: boolean;
}

interface BookmarkItem {
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

interface Collection {
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

interface DashboardProps {
  user: AuthUser;
  onSignOut: () => void;
  /** show a one-time "signed in" confirmation */
  welcome?: boolean;
  initialBookmarks?: BookmarkItem[];
  initialCollections?: Collection[];
}

/* ============================================================================================
 * Small utilities
 * ========================================================================================== */

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

function domainOf(url: string): string {
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
function formatDue(iso: string): { label: string; overdue: boolean; today: boolean } {
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
function semanticScore(item: BookmarkItem, query: string): number {
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
  user: AuthUser;
  onSignOut: () => void;
  onNavigate: (view: ViewId, opts?: { collectionId?: string | null; tag?: string | null }) => void;
}

function SidebarContent({ view, collectionId, tag, counts, collections, topTags, user, onSignOut, onNavigate }: SidebarProps) {
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
        <div className="mt-2 flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5" data-testid="account-chip">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fca311] text-xs font-bold text-[#14213d]">
            {user.name.split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
          <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className={cx('rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white', ring)}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
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

function Dashboard({ user, onSignOut, welcome = false, initialBookmarks = MOCK_BOOKMARKS, initialCollections = MOCK_COLLECTIONS }: DashboardProps) {
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

  useEffect(() => {
    if (welcome) showToast(user.isNew ? `Welcome, ${user.name.split(' ')[0]}. Your workspace is ready.` : `Signed in as ${user.email}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, when the dashboard first appears
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
    user,
    onSignOut,
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

/* ============================================================================================
 * 4. ROOT: switches between the auth suite and the dashboard
 * ========================================================================================== */

const MOTION_CSS = `
@keyframes bk-fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes bk-drift-a { 0%, 100% { transform: translate3d(0, 0, 0) scale(1); } 50% { transform: translate3d(70px, 50px, 0) scale(1.18); } }
@keyframes bk-drift-b { 0%, 100% { transform: translate3d(0, 0, 0) scale(1); } 50% { transform: translate3d(-60px, -40px, 0) scale(1.12); } }
@keyframes bk-beam { 0% { transform: translateX(-40%); opacity: 0; } 15%, 80% { opacity: 1; } 100% { transform: translateX(160%); opacity: 0; } }
@keyframes bk-node { 0%, 100% { opacity: 0.25; box-shadow: 0 0 0 0 rgba(252, 163, 17, 0); } 50% { opacity: 1; box-shadow: 0 0 14px 3px rgba(252, 163, 17, 0.55); } }
@keyframes bk-auth-leave { to { opacity: 0; transform: scale(1.02); filter: blur(8px); } }
@keyframes bk-app-enter { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes bk-auth-enter { from { opacity: 0; } to { opacity: 1; } }
.bk-fade-up { animation: bk-fade-up 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.bk-glow-a { animation: bk-drift-a 16s ease-in-out infinite; }
.bk-glow-b { animation: bk-drift-b 19s ease-in-out infinite; }
.bk-beam { animation: bk-beam 9s ease-in-out infinite; }
.bk-node { animation: bk-node 4.5s ease-in-out infinite; }
.bk-auth-leave { animation: bk-auth-leave 0.45s ease-in forwards; }
.bk-app-enter { animation: bk-app-enter 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.bk-auth-enter { animation: bk-auth-enter 0.4s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .bk-fade-up, .bk-glow-a, .bk-glow-b, .bk-beam, .bk-node, .bk-app-enter, .bk-auth-enter { animation: none !important; }
  .bk-auth-leave { animation-duration: 0.01s !important; }
}
`;

export interface BukmarkzAppProps {
  /** "dark" adds a `dark` class on the root (needs darkMode: 'class'); "system" leaves it to the OS */
  theme?: 'dark' | 'system';
  /** start already signed in (skips the auth screen) */
  initialUser?: AuthUser | null;
  onSignIn?: (user: AuthUser) => void;
  onSignOut?: () => void;
}

export default function BukmarkzApp({ theme = 'dark', initialUser = null, onSignIn, onSignOut }: BukmarkzAppProps = {}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [leavingAuth, setLeavingAuth] = useState(false); // auth screen fading out over the dashboard
  const [signedOut, setSignedOut] = useState(false); // fade the auth screen in only when coming back from the app
  const [welcome, setWelcome] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleAuthenticated = useCallback((next: AuthUser) => {
    setUser(next);
    setWelcome(true);
    setLeavingAuth(true);
    timer.current = setTimeout(() => setLeavingAuth(false), 450);
    onSignIn?.(next);
  }, [onSignIn]);

  const handleSignOut = useCallback(() => {
    setUser(null);
    setWelcome(false);
    setLeavingAuth(false);
    setSignedOut(true);
    onSignOut?.(); // MOCK: also revoke the session on your server
  }, [onSignOut]);

  return (
    // the dark backdrop means a fade never flashes the page's default white behind the auth screen
    <div className={cx(theme === 'dark' && 'dark', (!user || leavingAuth) && 'min-h-screen bg-[#05070d]')}>
      <style>{MOTION_CSS}</style>
      {user && (
        <div className="bk-app-enter">
          <Dashboard user={user} onSignOut={handleSignOut} welcome={welcome} />
        </div>
      )}
      {(!user || leavingAuth) && (
        <div className={leavingAuth ? 'bk-auth-leave pointer-events-none fixed inset-0 z-[70] overflow-hidden bg-[#05070d]' : signedOut ? 'bk-auth-enter' : undefined} data-testid="auth-layer">
          <AuthSuite onAuthenticated={handleAuthenticated} />
        </div>
      )}
    </div>
  );
}
