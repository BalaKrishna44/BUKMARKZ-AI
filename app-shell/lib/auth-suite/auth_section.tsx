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
  const nodes: Array<[number, number, number]> = [[3, 2, 0], [8, 4, 1.2], [5, 7, 2.4], [11, 3, 3.1], [2, 10, 0.7], [9, 11, 1.9], [13, 8, 2.8]];
  const mask = 'radial-gradient(ellipse 75% 65% at 35% 40%, #000 25%, transparent 78%)';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.055) 1px, transparent 1px)',
          backgroundSize: `${cell}px ${cell}px`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
      <div className="bk-glow-a absolute -left-28 -top-28 h-[30rem] w-[30rem] rounded-full bg-[#fca311]/20 blur-3xl" />
      <div className="bk-glow-b absolute -bottom-40 -right-10 h-[32rem] w-[32rem] rounded-full bg-sky-500/15 blur-3xl" />
      <div className="bk-beam absolute left-0 top-[34%] h-px w-2/3 bg-gradient-to-r from-transparent via-[#fca311]/70 to-transparent" />
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
    <button type="submit" disabled={status !== 'idle'} className={cx(authBtnPrimary, 'w-full', status === 'success' && 'disabled:opacity-100')} aria-live="polite">
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
  const shown = (f: FieldName) => (submitted || touched[f] ? errors[f] : undefined);
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
          <AuthField id="auth-email" label="Email" type="email" inputMode="email" value={email} onChange={setEmail} onBlur={() => setTouched(true)} icon={<Mail className="h-4 w-4" aria-hidden="true" />} autoComplete="email" placeholder="you@company.com" error={submitted || touched ? error ?? undefined : undefined} inputRef={ref} />
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
