import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Privacy Policy | Bukmarkz',
  description: 'How Bukmarkz collects, uses, stores and protects your data, and the rights you have under the GDPR and India’s DPDP Act.',
  alternates: { canonical: '/privacy' },
};

// ---------------------------------------------------------------------------------------------------------------------
// FILL THESE IN BEFORE LAUNCH. GDPR Art. 13 requires the controller's identity and postal address; the DPDP Act requires the
// Grievance Officer's contact details to be published. Nothing below is invented for you.
// ---------------------------------------------------------------------------------------------------------------------
const OPERATOR = '[Operator name: person or company that runs Bukmarkz]';
const ADDRESS = '2716 HSR, 31st Main Road, 16th Cross, Bangalore 560102, India';
const GRIEVANCE_OFFICER = '[Full name], Grievance Officer';
const LAST_UPDATED = '4 November 2026';

const SUPPORT = 'support@bukmarkz.com';
const GRIEVANCE = 'grievance@bukmarkz.com';

type Row = [string, string, string];
const PROCESSORS: Row[] = [
  ['Anthropic', 'Summaries, auto-tags, “Ask your vault” answers, voice-note titles', 'Text of items you save (page text, your notes, voice transcripts) and your questions'],
  ['OpenAI', 'Embeddings for search; speech-to-text for voice notes; text-to-speech for audio briefings', 'Text to embed, your search queries, voice recordings you upload, text you ask us to read aloud'],
  ['Google (Gemini)', 'Optional alternative model for summaries', 'Same as Anthropic, only where this provider is enabled'],
  ['Resend', 'Sending account, digest and notification emails', 'Your email address and the content of those emails'],
  ['Internet Archive (archive.org)', 'Looking up a saved copy of a link that has stopped working', 'The address (URL) of a dead link. Never sent for items you mark private'],
  ['Hosting provider (EU, Germany)', 'Servers, database and file storage', 'All data described in this policy'],
];

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
  ['who', 'Who is responsible'], ['collect', 'What we collect'], ['ai', 'How we process data and AI'], ['rights', 'Your rights'],
  ['grievance', 'Grievance Officer'], ['retention', 'Retention and sharing'], ['other', 'Security, children and changes'],
];

export default function PrivacyPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-slate-950 text-slate-200">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-emerald-500/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-48 top-1/3 -z-10 h-[30rem] w-[30rem] rounded-full bg-amber-400/10 blur-3xl" />

      <div className="mx-auto max-w-3xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <header className="mb-10">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-300">Legal</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Privacy Policy</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-400">
            Bukmarkz is a free AI-native bookmark manager, tab flusher and knowledge vault. Your vault is yours. This page explains exactly what we hold, who processes it, and how to get it back or erased.
          </p>
          <p className="mt-4 text-sm text-slate-500">Last updated: {LAST_UPDATED}. Applies to bukmarkz.com, the Bukmarkz browser extension and the Bukmarkz mobile web app.</p>
        </header>

        <nav aria-label="On this page" className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="text-slate-400 transition hover:text-emerald-300">{label}</a></li>
            ))}
          </ul>
        </nav>

        <div className="space-y-6">
          <Section id="who" n={1} title="Who is responsible for your data">
            <p>
              Bukmarkz is operated as an independent product by <B>{OPERATOR}</B>, {ADDRESS}. For the EU General Data Protection Regulation (GDPR) we are the <B>data controller</B>. For India’s Digital Personal Data Protection Act, 2023 (DPDP Act) we are the <B>Data Fiduciary</B>, and you are the <B>Data Principal</B>.
            </p>
            <p>Questions, requests and complaints: <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A>. For formal grievances, see <A href="#grievance">section 5</A>.</p>
          </Section>

          <Section id="collect" n={2} title="What personal and technical data we collect">
            <h3 className="font-semibold text-white">a) Account data</h3>
            <UL>
              <li>Your email address and a login identity. Passwords are never stored by us in readable form: they are hashed by our authentication system. If you sign in with a third-party identity provider, we receive the profile details you authorise.</li>
              <li>Settings you choose (for example email preferences, language, and whether you have switched on the weekly digest).</li>
            </UL>
            <h3 className="font-semibold text-white">b) Stored content (your vault)</h3>
            <UL>
              <li>The links you save, titles, notes, highlights, tags and collections, and the tags and categories the extension or AI adds.</li>
              <li>An optional profile picture. We crop it to a square, shrink it to 256 pixels and remove its metadata (such as location), and we store only that resized copy.</li>
              <li>Text extracted from saved pages (and, where you use the feature, an archived copy or snapshot of the page).</li>
              <li>Voice notes you record (we keep the transcript and summary; the audio is sent for transcription, see section 3) and text from images you scan.</li>
              <li><B>Vector embeddings</B>: lists of numbers generated from your content so we can search by meaning. They are derived from your content and are treated as your data.</li>
            </UL>
            <h3 className="font-semibold text-white">c) Extension and app telemetry</h3>
            <UL>
              <li>Technical data needed to run the service: IP address and request time (security and rate limiting), browser and extension version, device type, and error reports.</li>
              <li>Which action created an item (for example extension, mobile share, import) and when links were last checked.</li>
              <li>The extension only reads a page when you save it or use a feature that needs it. It does not record your browsing history.</li>
              <li>We use only the cookies and local storage needed to keep you signed in and remember your preferences. We do not use advertising trackers.</li>
            </UL>
            <p>We obtain page content by fetching the public web address you save. We do not collect payment card data: Bukmarkz is currently a free beta.</p>
          </Section>

          <Section id="ai" n={3} title="How we process data, and AI disclosures">
            <p>We process your data to run your account, store and search your vault, extract page text, generate summaries and tags, answer questions about your vault, check for broken links, and send the emails you ask for. Our legal bases under the GDPR are performance of our contract with you (providing the service), your consent (for optional features, which you can withdraw), and our legitimate interests in security and preventing abuse.</p>
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-100">
              <p className="font-semibold">AI processing, in plain words</p>
              <p className="mt-2">
                To provide search and summaries, the text of items you save, your questions, and the vector embeddings we create are sent to third-party AI providers (listed below). They process it only to return the result to us.
              </p>
              <p className="mt-2 font-semibold text-white">We do NOT sell user data or train public foundation models on user vault content.</p>
            </div>
            <UL>
              <li>We use the providers’ business API services, under terms that do not allow them to train their models on API data. We do not turn on any setting that would permit it.</li>
              <li>Items you mark <B>private</B> are never sent to AI providers and are not included in AI search, MCP results or digests.</li>
              <li>AI output can be wrong. Summaries and tags are suggestions, and no decision with legal or similar effect about you is made by automated means.</li>
            </UL>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Service providers that process data for us</caption>
                <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
                  <tr><th scope="col" className="px-4 py-3">Provider</th><th scope="col" className="px-4 py-3">Purpose</th><th scope="col" className="px-4 py-3">What it receives</th></tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {PROCESSORS.map(([who, why, what]) => (
                    <tr key={who} className="align-top"><th scope="row" className="px-4 py-3 font-medium text-white">{who}</th><td className="px-4 py-3">{why}</td><td className="px-4 py-3">{what}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>Some providers process data outside the EU and India (for example in the United States). Where that happens we rely on a lawful transfer mechanism such as Standard Contractual Clauses or the provider’s certification under the EU–US Data Privacy Framework. A provider may keep API requests for a short period under its own terms (for example for abuse monitoring) before deleting them.</p>
          </Section>

          <Section id="rights" n={4} title="Your rights (GDPR and DPDP Act)">
            <UL>
              <li><B>Access and export.</B> You can download your whole vault (links, notes, tags and highlights) at any time from <B>Settings → Export</B>, as JSON or as a standard browser-bookmarks HTML file. You can also ask us for a copy of the personal data we hold about you.</li>
              <li>
                <B>Erasure / deletion.</B> You can delete your account in <B>Settings → Delete account</B>, or email <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> from your registered address. Deleting your account permanently removes your login, every saved link, note, highlight, tag, collection and snapshot, and all of your vector embeddings from our database. Deletion cannot be undone, and we cannot restore it afterwards. You can also delete single items at any time.
              </li>
              <li><B>Withdraw consent.</B> Where we rely on your consent (for example optional AI features or marketing-style emails such as the weekly digest), you can withdraw it at any time in Settings or with the unsubscribe link in any email. Withdrawal does not affect processing done before, and it may mean a feature stops working.</li>
              <li><B>Correction and updating.</B> You can edit your items and account details yourself, or ask us to correct them.</li>
              <li><B>Also under the GDPR:</B> restriction of processing, objection to processing based on legitimate interests, and portability of your data in a commonly used format.</li>
              <li><B>Also under the DPDP Act:</B> the right to nominate another person to exercise your rights if you die or become unable to.</li>
            </UL>
            <p>Email <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> to use any right. We may need to confirm it is you. We reply within 30 days. You may also complain to your local data protection authority (in the EU, the authority in your country of residence; in India, the Data Protection Board of India), but we ask that you give us the chance to fix it first.</p>
          </Section>

          <Section id="grievance" n={5} title="Grievance Officer and redressal">
            <p>If you have a complaint about how we handle your personal data, or about the exercise of your rights, contact our Grievance Officer:</p>
            <dl className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-slate-500">Name / role</dt><dd className="text-white">{GRIEVANCE_OFFICER}</dd>
              <dt className="text-slate-500">Email</dt><dd><A href={`mailto:${GRIEVANCE}`}>{GRIEVANCE}</A></dd>
              <dt className="text-slate-500">Address</dt><dd className="text-white">{ADDRESS}</dd>
              <dt className="text-slate-500">Response time</dt><dd className="text-white">Within 30 days of receiving your complaint</dd>
            </dl>
            <p>Please include your registered email address and a description of the problem. If you are not satisfied with our response, you may approach the Data Protection Board of India (under the DPDP Act) or your local EU supervisory authority (under the GDPR).</p>
          </Section>

          <Section id="retention" n={6} title="Data retention and third-party sharing">
            <UL>
              <li><B>Where it is stored.</B> Your account data and vault are stored on secured servers in the European Union (Germany). Access is limited to what is needed to run the service.</li>
              <li><B>How long.</B> We keep your data only until you delete your account. After deletion we do not retain your vault content, and we do not keep it for analytics. We may keep limited records we are legally required to keep, or need to handle a dispute, for as long as that requires.</li>
              <li><B>Who we share it with.</B> Only the service providers in the table in section 3, and only for the purposes listed there. We do not sell your personal data, and we do not share it for advertising. We may disclose data if a law or a valid legal order requires it.</li>
              <li><B>Business changes.</B> If Bukmarkz is ever transferred to another operator, we will tell you first and your rights in this policy will continue.</li>
            </UL>
          </Section>

          <Section id="other" n={7} title="Security, children and changes">
            <UL>
              <li><B>Security.</B> Data is encrypted in transit, access to each user’s vault is restricted by row-level security in the database, and secrets are kept out of the browser. No system is perfectly secure. If a breach is likely to put you at risk, we will notify you and the relevant authority as the law requires.</li>
              <li><B>Children.</B> Bukmarkz is not intended for anyone under 18. We do not knowingly collect their data. If you think a child has an account, email <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A> and we will delete it.</li>
              <li><B>Changes.</B> If we change this policy in a way that matters, we will tell you by email or in the app before the change takes effect. The date at the top shows the latest version.</li>
            </UL>
          </Section>
        </div>

        <p className="mt-10 text-center text-sm text-slate-500">
          Questions? Write to <A href={`mailto:${SUPPORT}`}>{SUPPORT}</A>.
        </p>
      </div>
    </main>
  );
}
