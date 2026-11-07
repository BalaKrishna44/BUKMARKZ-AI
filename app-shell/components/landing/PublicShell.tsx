import Link from 'next/link';
import Wordmark from '@/components/brand/Wordmark';
import './landing.css';

/** Light-green chrome shared by the public marketing pages. */
export default function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bkl">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" />
      <div className="wrap">
        <nav aria-label="Main">
          <Link href="/" className="logo" aria-label="Bukmarkz home"><Wordmark /></Link>
          <div className="links"><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/download">Download</Link><Link href="/#faq">FAQ</Link></div>
          <div className="navr"><Link className="signin" href="/login">Sign in</Link><Link className="btn p" href="/signup?plan=pro-trial">Get started</Link></div>
        </nav>
        {children}
        <footer>
          <span>© {new Date().getFullYear()} Bukmarkz. All rights reserved.</span>
          <nav aria-label="Footer"><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
        </footer>
      </div>
    </div>
  );
}
