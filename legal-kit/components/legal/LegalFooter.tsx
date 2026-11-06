import Link from 'next/link';

/** Drop-in footer links for any page. */
export default function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`flex gap-4 text-sm text-gray-400 ${className}`}>
      <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
      <Link href="/terms" className="hover:underline">Terms of Service</Link>
    </footer>
  );
}
