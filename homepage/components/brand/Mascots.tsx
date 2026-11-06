/** Buk (wise scholar owl) and Markz (curious bookmark sidekick), drawn inline so pages need no image files. Decorative by default; pass `title` to make one meaningful. */
interface P { className?: string; title?: string }
const a11y = (title?: string) => (title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const });

export function Buk({ className = '', title }: P) {
  return (
    <svg viewBox="0 0 64 64" className={className} {...a11y(title)}>
      <ellipse cx="32" cy="42" rx="19" ry="17" fill="#0f6b3e" /><ellipse cx="32" cy="46" rx="11" ry="10" fill="#d4f3e2" />
      <circle cx="32" cy="27" r="17" fill="#1a7f4e" />
      <circle cx="25" cy="27" r="7.5" fill="#fff" /><circle cx="39" cy="27" r="7.5" fill="#fff" />
      <circle cx="25" cy="27.5" r="3.2" fill="#10261c" /><circle cx="39" cy="27.5" r="3.2" fill="#10261c" />
      <circle cx="26" cy="26.4" r="1" fill="#fff" /><circle cx="40" cy="26.4" r="1" fill="#fff" />
      <circle cx="25" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><circle cx="39" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><path d="M34 27h-2" stroke="#fca311" strokeWidth="1.6" />
      <path d="M29 34l3 4 3-4z" fill="#fca311" />
      <g transform="translate(0 -5)">
      <path d="M13 14l19-8 19 8-19 8z" fill="#10261c" /><path d="M20 19v6c0 3 6 5 12 5s12-2 12-5v-6l-12 5z" fill="#173525" />
      <path d="M51 14v9" stroke="#fca311" strokeWidth="1.6" /><circle cx="51" cy="25" r="2" fill="#fca311" />
      </g>
    </svg>
  );
}

export function Markz({ className = '', title }: P) {
  return (
    <svg viewBox="0 0 64 64" className={className} {...a11y(title)}>
      <path d="M16 12h32a3 3 0 0 1 3 3v40l-19-11-19 11V15a3 3 0 0 1 3-3z" fill="#fca311" />
      <path d="M22 12h20v14H22z" fill="#ffb938" opacity=".5" />
      <circle cx="25" cy="27" r="6.5" fill="#fff" /><circle cx="39" cy="27" r="6.5" fill="#fff" />
      <circle cx="26.5" cy="28" r="3" fill="#10261c" /><circle cx="40.5" cy="28" r="3" fill="#10261c" />
      <circle cx="27.4" cy="26.8" r="1" fill="#fff" /><circle cx="41.4" cy="26.8" r="1" fill="#fff" />
      <path d="M26 38q6 5 12 0" fill="none" stroke="#10261c" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 12V5" stroke="#fca311" strokeWidth="2" /><circle cx="32" cy="4.5" r="2.5" fill="#fca311" />
    </svg>
  );
}
