import type { Metadata } from 'next';
import ResumeImport from '@/components/switch/ResumeImport';

export const metadata: Metadata = { title: 'Finish your import · Bukmarkz', robots: { index: false, follow: false } };
export default function ResumePage() {
  return <main className="grid min-h-screen place-items-center bg-slate-950 px-4 py-12"><ResumeImport /></main>;
}
