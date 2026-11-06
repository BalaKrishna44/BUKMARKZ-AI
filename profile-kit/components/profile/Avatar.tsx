/** Profile picture with an initial-letter fallback. Pass `url` only from a trusted source (our own user_profiles row, already pinned to our Storage origin). */
export default function Avatar({ url, name, size = 32, className = '' }: { url?: string | null; name?: string | null; size?: number; className?: string }) {
  const letter = (name?.trim()[0] ?? '?').toUpperCase();
  const box = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} style={box} className={`shrink-0 rounded-full object-cover ${className}`} referrerPolicy="no-referrer" loading="lazy" decoding="async" />;
  }
  return <span aria-hidden style={box} className={`inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold text-white ${className}`}>{letter}</span>;
}
