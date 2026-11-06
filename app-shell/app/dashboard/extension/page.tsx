import type { Metadata } from 'next';
import { Page, Panel } from '@/components/shell/ui';

export const metadata: Metadata = { title: 'Browser extension · Bukmarkz' };

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#eaf3ed] text-xs font-bold text-[#1a7f4e]">{n}</span><span className="text-sm text-[#33443b]">{children}</span></li>
);

export default function ExtensionPage() {
  return (
    <Page title="Browser extension" lead="Save any page in one click from Chrome, and flush a whole window of tabs into a session. The extension signs in automatically when you are signed in here.">
      <Panel title="Install (Chrome, Edge, Brave)">
        <ol className="space-y-3">
          <Step n={1}>Download the extension folder from <a className="font-semibold text-[#1a7f4e] hover:underline" href="https://github.com/BalaKrishna44/BUKMARKZ-AI/tree/main/ext3" target="_blank" rel="noopener noreferrer">the project on GitHub</a> (use “Download ZIP” on the repository and unzip it).</Step>
          <Step n={2}>Open <code className="rounded bg-[#eaf3ed] px-1">chrome://extensions</code> and switch on <b>Developer mode</b> (top right).</Step>
          <Step n={3}>Click <b>Load unpacked</b> and choose the unzipped <code className="rounded bg-[#eaf3ed] px-1">ext3</code> folder (the one that contains <code className="rounded bg-[#eaf3ed] px-1">manifest.json</code>).</Step>
          <Step n={4}>Pin the Bukmarkz icon to your toolbar, then stay signed in to this site.</Step>
        </ol>
      </Panel>
      <Panel title="Use it"><ul className="list-disc space-y-1.5 pl-5 text-sm text-[#33443b]"><li>Click the icon on any page to save it to your vault.</li><li>Choose <b>Flush session</b> to save every open tab as one session, then close them.</li><li>Your sessions appear under <b>Flush session</b> in the sidebar.</li></ul></Panel>
      <Panel><p className="text-sm text-[#4b5c53]">A one-click Chrome Web Store listing is not published yet. Until it is, the steps above are the way to install.</p></Panel>
    </Page>
  );
}
