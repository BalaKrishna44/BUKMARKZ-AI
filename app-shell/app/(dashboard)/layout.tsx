import type { Metadata } from 'next';

// Signed-in area: never indexed. Add your auth redirect here (see the Snippet Vault page for the pattern) once pages use real data.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-950 bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgba(16,185,129,.12),transparent)]">{children}</div>;
}
