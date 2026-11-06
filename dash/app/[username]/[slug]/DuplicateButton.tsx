'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { duplicateStack, type DuplicateState } from '@/app/actions/duplicateStack';

const MESSAGE = { invalid: 'That stack link looks wrong.', not_found: 'This stack is no longer public.', failed: 'Something went wrong. Please try again.' } as const;

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}
      className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-wait disabled:opacity-70 sm:w-auto">
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
      {pending ? 'Duplicating…' : `Duplicate to My Vault (${count} link${count === 1 ? '' : 's'})`}
    </button>
  );
}

/** Works for signed-in and signed-out visitors: the server action sends signed-out visitors to sign-up and back. */
export function DuplicateButton({ slug, count }: { slug: string; count: number }) {
  const [state, action] = useActionState<DuplicateState, FormData>(duplicateStack, null);
  return (
    <form action={action} className="w-full sm:w-auto">
      <input type="hidden" name="slug" value={slug} />
      <Submit count={count} />
      {state && !state.ok && <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{MESSAGE[state.error]}</p>}
    </form>
  );
}
