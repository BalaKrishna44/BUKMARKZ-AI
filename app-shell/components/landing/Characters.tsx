/** Markz (the confused robot) and Buk (the wise librarian-wizard), drawn inline. Decorative: the surrounding text carries the meaning. */
export function MarkzRobot({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 200" className={className} aria-hidden="true">
      <ellipse cx="90" cy="188" rx="58" ry="7" fill="#0002" />
      <path d="M90 28V14" stroke="#4aa84a" strokeWidth="4" /><circle cx="90" cy="11" r="6" fill="#6fd16f" />
      <path d="M52 112c-6 22 2 62 38 62s44-40 38-62c-6-22-70-22-76 0z" fill="#b53bd8" />
      <path d="M60 120c-8 16-4 42 10 54" stroke="#d27ae9" strokeWidth="5" fill="none" strokeLinecap="round" opacity=".7" />
      <text x="90" y="160" textAnchor="middle" fontSize="52" fontWeight="800" fill="#fff" fontFamily="Plus Jakarta Sans,sans-serif">?</text>
      <rect x="30" y="26" width="120" height="92" rx="34" fill="#8a22b3" /><rect x="40" y="36" width="100" height="72" rx="26" fill="#14081f" />
      <circle cx="70" cy="70" r="13" fill="#3aa0ff" /><circle cx="66" cy="66" r="4" fill="#fff" /><circle cx="108" cy="70" r="8" fill="#9be46f" />
      <path d="M72 94q6-6 11 0t11 0t11 0" stroke="#9be46f" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M132 112c14-6 24-22 14-40" stroke="#b53bd8" strokeWidth="12" fill="none" strokeLinecap="round" />
      <ellipse cx="68" cy="178" rx="20" ry="8" fill="#4fc3f7" /><ellipse cx="112" cy="178" rx="20" ry="8" fill="#4fc3f7" />
    </svg>
  );
}

export function BukWizard({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 130 210" className={className} aria-hidden="true">
      <ellipse cx="62" cy="200" rx="48" ry="6" fill="#0002" />
      <rect x="101" y="46" width="5" height="152" rx="2.5" fill="#e0a526" />
      <path d="M94 12h19v35l-9.5-8-9.5 8z" fill="#e8b230" stroke="#c98f12" strokeWidth="1.5" strokeLinejoin="round" /><path d="M99 16h9v22l-4.5-4-4.5 4z" fill="#f6cf62" opacity=".7" />
      <path d="M34 80L20 190q42 12 84 0L90 80z" fill="#3a35b0" /><path d="M20 190q42 12 84 0" stroke="#2a2680" strokeWidth="4" fill="none" />
      <path d="M25 183q37 9 74 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeDasharray="2 3" opacity=".6" />
      <path d="M30 100Q20 120 28 136" stroke="#3a35b0" strokeWidth="13" fill="none" strokeLinecap="round" /><circle cx="27" cy="139" r="6" fill="#e6e6ee" />
      <path d="M90 96Q116 86 107 118" stroke="#3a35b0" strokeWidth="13" fill="none" strokeLinecap="round" /><circle cx="104" cy="121" r="6" fill="#e6e6ee" />
      <ellipse cx="62" cy="40" rx="24" ry="22" fill="#f6e4d6" /><path d="M38 36Q62 10 86 36Q62 28 38 36z" fill="#f4f4f8" />
      <path d="M42 46L82 46L87 150Q62 162 37 150z" fill="#f4f4f8" stroke="#d6d8e6" strokeWidth="1.5" />
      <path d="M47 38q6-8 12 0M65 38q6-8 12 0" stroke="#4a3a35" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M50 33l-3-3M54 31l-1-4M72 31l1-4M77 33l3-3" stroke="#4a3a35" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M53 56q9 8 18 0" stroke="#b5503a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M48 154l14-12 14 12v24H48z" fill="#2a2680" /><path d="M54 156v20M59 154v22M64 154v22M69 156v20" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
