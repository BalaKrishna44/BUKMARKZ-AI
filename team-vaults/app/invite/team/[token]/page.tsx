'use client';
import { useActionState } from 'react';
import { use } from 'react';
import { acceptTeamShare, type AcceptState } from '@/app/actions/acceptTeamShare';

const MSG: Record<string, string> = {
  invalid: 'This invite is invalid, already used, or has expired. Ask your colleague to send it again.',
  wrong_account: 'You are signed in with a different email address than the one invited. Sign in with the invited address.',
  seat_limit: 'This workspace has no free seats right now. Ask an admin.',
  unverified: 'Please verify your email address first, then open this link again.',
  failed: 'Something went wrong. Try again in a minute.',
};
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptTeamShare, null);
  return (
    <main style={{ maxWidth: 440, margin: '12vh auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1>You have been invited to a research stack</h1>
      <p>Accept to join the workspace as a viewer. Your own bookmarks stay private.</p>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <button disabled={pending}>{pending ? 'Joining…' : 'Accept invite'}</button>
      </form>
      {state && !state.ok && <p role="alert">{MSG[state.error]}</p>}
    </main>
  );
}
