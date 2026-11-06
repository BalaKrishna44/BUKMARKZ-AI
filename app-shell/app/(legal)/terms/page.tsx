import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Terms of Service | Bukmarkz',
  description: 'The rules for using Bukmarkz: the free beta, acceptable use, your content, liability, and how to close your account.',
  alternates: { canonical: '/terms' },
};

// FILL THESE IN BEFORE LAUNCH (same values as the Privacy Policy). Nothing here is invented for you.
const OPERATOR = '[Operator name: person or company that runs Bukmarkz]';
const ADDRESS = '[Postal address]';
const LAST_UPDATED = '4 November 2026';
const SUPPORT = 'support@bukmarkz.com';

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/20 backdrop-blur-xl sm:p-8">
      <h2 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">
        <span className="font-mono text-sm text-emerald-300/80">{String(n).padStart(2, '0')}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-300">{children}</div>
    </section>
  );
}

const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-2 pl-5 marker:text-emerald-400/70">{children}</ul>;
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className="font-medium text-emerald-300 underline decoration-emerald-300/30 underline-offset-4 transition hover:decoration-emerald-300">{children}</a>
);
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-white">{children}</strong>;

const TOC: [string, string][] = [
  ['accept', 'Acceptance'], ['beta', 'Free beta'], ['aup', 'Acceptable use'], ['content', 'Your content'],
  ['liability', 'Warranties and liability'], ['termination', 'Closing your account'], ['law', 'Governing law'], ['general', 'General'],
];

export default function TermsPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-slate-950 text-slate-200">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-emerald-500/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-48 top-1/3 -z-10 h-[30rem] w-[30rem] rounded-full bg-amber-400/10 blur-3xl" />

      <div className="mx-auto max-w-3xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <header className="mb-10">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-300">Legal</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Terms of Service</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-400">
            The short version: Bukmarkz is a free beta. Your saved content stays yours. Don’t use the service to harm people or the system. Keep your own backup, because we can’t promise nothing will ever go wrong.
          </p>
          <p className="mt-4 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
        </header>

        <nav aria-label="On this page" className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="text-slate-400 transition hover:text-emerald-300">{label}</a></li>
            ))}
          </ul>
        </nav>

        <div className="space-y-6">
          <Section id="accept" n={1} title="Acceptance of these Terms">
            <p>
              These Terms are an agreement between you and <B>{OPERATOR}</B>, {ADDRESS} (“Bukmarkz”, “we”, “us”). By <B>creating an account</B>, <B>installing the Bukmarkz browser extension (including ext3)</B>, or otherwise using bukmarkz.com or the Bukmarkz mobile web app (together, the “Service”), you agree to these Terms and to our <A href="/privacy">Privacy Policy</A>. If you do not agree, do not create an account, uninstall the extension and stop using the Service.
            </p>
            <UL>
              <li>You must be at least 18 years old and able to form a binding agreement. If you use the Service for an organisation, you confirm you may bind it.</li>
              <li>Keep your login secure. You are responsible for activity under your account. Tell us at <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> if you think it has been misused.</li>
            </UL>
          </Section>

          <Section id="beta" n={2} title="The free beta Service">
            <p>
              Bukmarkz lets you save links, extract the text of saved pages, get AI summaries, tags and answers about your vault, record voice notes, and sync tabs through a browser extension. Today the Service is a <B>free beta</B>.
            </p>
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-amber-50">
              <p>
                <B>The Service is provided “AS IS” and “AS AVAILABLE”, during the beta, with no fee commitments.</B> Features may change, be limited or be removed, and the Service may be interrupted, reset or discontinued. We make no promise that any feature, quota or price will stay the same.
              </p>
            </div>
            <UL>
              <li>If we start charging, we will tell you in advance. You will not be charged for anything unless you agree to a paid plan.</li>
              <li>We will try to give you notice before shutting the Service down, so you can export your vault, but we cannot guarantee it.</li>
              <li>Features that use AI, or that fetch pages from the web, are best-effort and may be rate-limited.</li>
            </UL>
          </Section>

          <Section id="aup" n={3} title="Acceptable use policy">
            <p>You agree not to use the Service, including its scraping, AI and API features, to:</p>
            <UL>
              <li>store, fetch, share or distribute <B>illegal content</B>, including child sexual abuse material, content that infringes others’ rights, or content that is defamatory, harassing or promotes violence;</li>
              <li>store, link to, distribute or test <B>malware</B>, exploits or other harmful code, or <B>phishing</B> or other deceptive links or pages;</li>
              <li>abuse the AI, search, scraping or API routes, for example by automated or excessive requests, queries designed to overload or exhaust capacity, or attempts to cause a <B>denial of service</B>;</li>
              <li>point our page fetcher at systems you do not have permission to access, including private networks, internal addresses or other people’s servers, or try to get around our limits, filters or security;</li>
              <li>scrape or copy third-party sites in ways that break the law or those sites’ terms, or that you do not have the right to do;</li>
              <li>access another person’s account or data, probe or attack the Service, or reverse engineer it except where the law allows;</li>
              <li>resell the Service, or use it to build a competing product by bulk-extracting its output;</li>
              <li>try to extract another user’s private content, or use AI features to produce content that is unlawful or that harms others.</li>
            </UL>
            <p>
              <B>Enforcement.</B> We may remove content, limit features, <B>suspend or terminate your account without prior notice</B> if we reasonably believe you have breached this section, and we may report unlawful activity to the authorities. We will try to explain what happened when we can do so lawfully. If you think we got it wrong, email <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A>.
            </p>
            <p>To report content or abuse, including a copyright complaint, email <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> with the link and what is wrong.</p>
          </Section>

          <Section id="content" n={4} title="Your content and intellectual property">
            <UL>
              <li><B>You own your content.</B> You keep 100% ownership of the links, notes, highlights, tags, voice recordings and anything else you save or upload (“Your Content”). We do not claim ownership of it.</li>
              <li><B>Limited licence to us.</B> You give us a limited, non-exclusive, worldwide licence to host, process, embed and index Your Content, solely to operate the Service for you: to store it, create embeddings and summaries, search it, and display it back to you (and to people you choose to share it with). This licence ends when you delete the content or your account, apart from the short time needed to complete deletion.</li>
              <li><B>Use limits.</B> We do not sell Your Content, and we do not use it to train public foundation models. How AI providers handle it is described in the <A href="/privacy">Privacy Policy</A>.</li>
              <li><B>Your responsibility.</B> You are responsible for Your Content and for having the right to save it and to have us fetch and process it. Pages you save belong to their owners. The Service stores copies for your personal use and does not give you any rights in them.</li>
              <li><B>Our property.</B> The Service, its software, design, name and logos belong to us or our licensors. These Terms give you a personal, revocable right to use the Service, nothing more.</li>
              <li><B>Feedback.</B> If you send us ideas, we may use them without obligation to you.</li>
            </UL>
          </Section>

          <Section id="liability" n={5} title="Warranty disclaimer and limitation of liability">
            <p className="uppercase tracking-wide text-slate-200 [text-wrap:pretty]">
              To the fullest extent the law allows, the Service is provided without warranties of any kind, express or implied, including any warranty of merchantability, fitness for a particular purpose, accuracy, availability, security or non-infringement.
            </p>
            <p>In particular, <B>we are not responsible for</B>:</p>
            <UL>
              <li><B>data loss</B>, corruption, or missing or deleted bookmarks, notes, tags or embeddings, however caused. Keep your own backup: you can export your vault at any time from Settings;</li>
              <li><B>link rot</B>: pages that move, change or disappear, and saved or archived copies that are missing or incomplete. Our dead-link flags and links to archived copies are provided as a convenience and can be wrong;</li>
              <li><B>downtime</B>: servers being unavailable, slow or restarted, or features that stop working;</li>
              <li>inaccurate, incomplete or inappropriate <B>AI output</B> (summaries, tags, answers, transcripts). Check anything important yourself;</li>
              <li>third-party sites, services or providers, or what you do with content from them.</li>
            </UL>
            <p className="uppercase tracking-wide text-slate-200 [text-wrap:pretty]">
              To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill. Our total liability for all claims relating to the Service is limited to the amount you paid us for the Service in the 12 months before the claim, which during the free beta is zero.
            </p>
            <p>Nothing in these Terms excludes or limits liability that cannot be excluded by law, including for death or personal injury caused by negligence, for fraud, or for wilful misconduct or gross negligence, and nothing limits any mandatory rights you have as a consumer where you live. You agree to cover our reasonable losses if your breach of the AUP or your unlawful content leads to a claim against us by a third party.</p>
          </Section>

          <Section id="termination" n={6} title="Termination and account deletion">
            <UL>
              <li><B>You can stop any time.</B> To close your account and purge your data, go to <B>Settings → Delete account</B> and confirm, or email <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> from your registered address. Export your vault first if you want to keep it: <B>Settings → Export</B>.</li>
              <li><B>What deletion does.</B> It permanently removes your login, saved links, notes, highlights, tags, collections, snapshots and vector embeddings. It cannot be undone and we cannot restore it. Uninstall the browser extension separately from your browser.</li>
              <li><B>We can end it too.</B> We may suspend or terminate your access under section 3, if you breach these Terms, if required by law, or if we discontinue the Service or the beta, with notice where we reasonably can.</li>
              <li><B>After termination.</B> Sections that by nature should survive (ownership, disclaimers, liability, governing law) continue to apply.</li>
            </UL>
          </Section>

          <Section id="law" n={7} title="Governing law">
            <p>
              These Terms and any dispute arising from them or from the Service are governed by the applicable local digital and data-protection laws, without regard to conflict-of-law principles. Nothing here removes the protection of mandatory laws of the place where you live, including any consumer rights you have to bring a claim in your local courts.
            </p>
            <p>Please contact us at <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> first so we can try to settle it informally.</p>
          </Section>

          <Section id="general" n={8} title="General">
            <UL>
              <li><B>Changes.</B> We may update these Terms. If a change matters, we will tell you by email or in the app before it applies. Using the Service after the change means you accept it.</li>
              <li><B>Whole agreement.</B> These Terms and the Privacy Policy are the whole agreement between us about the Service.</li>
              <li><B>If part is invalid</B>, the rest stays in force. If we don’t enforce a right straight away, we haven’t given it up.</li>
              <li><B>Assignment.</B> You may not transfer your account or these Terms. We may transfer them as part of a business change, as described in the Privacy Policy.</li>
              <li><B>Contact.</B> <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A>.</li>
            </UL>
          </Section>
        </div>

        <p className="mt-10 text-center text-sm text-slate-500">
          See also our <A href="/privacy">Privacy Policy</A>.
        </p>
      </div>
    </main>
  );
}
