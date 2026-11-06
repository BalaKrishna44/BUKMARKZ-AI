import type { Metadata } from 'next';
import { Page } from '@/components/shell/ui';
import TokenManager from './TokenManager';

export const metadata: Metadata = { title: 'Connect Claude / Cursor' };

export default function Connect() {
  return (
    <Page title="Connect Claude / Cursor" lead="Let your AI tools search your vault, read your highlights and save links for you. You control access with tokens you can revoke at any time.">
      <TokenManager />
    </Page>
  );
}
