import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, Panel } from '@/components/shell/ui';

export const metadata: Metadata = { title: 'Topic briefs' };

const PROMPTS = [
  'Using my Bukmarkz vault, write a brief on React 19 caching with the sources I saved.',
  'What have I saved about FastAPI setup? Group it by theme and list the links.',
  'Search my vault for pricing page teardowns and summarise the common patterns.',
  'Show my recent highlights and tell me what I keep coming back to.',
];

export default function Briefs() {
  return (
    <Page title="Topic briefs" lead="Ask Claude or Cursor what your vault knows about a topic. It searches your saved links, merges the results and answers with a short brief that cites your own sources.">
      <Panel title="How it works">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[#33443b]">
          <li>Create a connection token on <Link className="font-semibold text-[#1a7f4e] hover:underline" href="/dashboard/connect">Connect Claude / Cursor</Link>.</li>
          <li>Add it to Claude Desktop or Cursor using the snippet shown there.</li>
          <li>Ask a question in your own words. Try one of these:</li>
        </ol>
        <ul className="mt-3 space-y-2">{PROMPTS.map((p) => <li key={p} className="rounded-xl bg-[#f1f9f4] px-3 py-2 text-sm text-[#10261c]">{p}</li>)}</ul>
      </Panel>
      <Panel title="Tools it uses"><ul className="list-disc space-y-1 pl-5 text-sm text-[#33443b]"><li><b>Synthesize vault topics</b>: several searches merged into one brief.</li><li><b>Search my vault</b>: meaning-based search over everything you saved.</li><li><b>Recent highlights</b>: what you marked in your reading.</li><li><b>Save a link</b>: add a bookmark from the chat.</li></ul></Panel>
    </Page>
  );
}
