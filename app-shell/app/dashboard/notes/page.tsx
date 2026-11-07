import type { Metadata } from 'next';
import NotesApp from './NotesApp';

export const metadata: Metadata = { title: 'Notes' };

export default function NotesPage() {
  return <NotesApp />;
}
