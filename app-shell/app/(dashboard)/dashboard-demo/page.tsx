import type { Metadata } from 'next';
import DashboardDemo from '@/components/dashboard/DashboardDemo';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return <DashboardDemo />;
}
