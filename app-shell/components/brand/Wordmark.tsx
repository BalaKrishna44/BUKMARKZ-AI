/** "Bukmarkz" with eyes in the u. Inline SVG + text, so it needs no image file and follows the surrounding colour (set `color`). */
export function EyeU({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" focusable="false" style={{ display: 'inline-block', height: '0.78em', width: '0.78em', verticalAlign: '-0.02em', overflow: 'visible' }}>
      <path d="M5 1.5v13a9 9 0 0 0 18 0v-13" fill="none" stroke="currentColor" strokeWidth="6.4" strokeLinecap="butt" />
      <circle cx="10.4" cy="11" r="4.3" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="17.6" cy="11" r="4.3" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.2" cy="11.6" r="1.9" fill="#10261c" /><circle cx="18.4" cy="11.6" r="1.9" fill="#10261c" />
      <circle cx="11.8" cy="10.9" r=".6" fill="#fff" /><circle cx="19" cy="10.9" r=".6" fill="#fff" />
    </svg>
  );
}

export default function Wordmark({ className = '', accent = '#f4a52a' }: { className?: string; accent?: string }) {
  return (
    <span className={className} role="img" aria-label="Bukmarkz" style={{ fontWeight: 800, letterSpacing: '-0.03em', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true">B<EyeU />kmark<span style={{ color: accent }}>z</span></span>
    </span>
  );
}
