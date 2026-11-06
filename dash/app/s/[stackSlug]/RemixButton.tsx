'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { remixStack, resumeRemix, type RemixState } from '@/app/actions/remixStack';

const MESSAGE = {
  invalid: 'That stack link looks wrong.',
  not_found: 'This stack is no longer public.',
  failed: 'Something went wrong. Please try again.',
} as const;

function Submit({ label, className }: { label: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className ?? 'w-full rounded-xl bg-[#2fa66a] px-5 py-3 font-semibold text-white hover:bg-[#1a7f4e] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a7f4e]'}>
      {pending ? 'Adding…' : label}
    </button>
  );
}

/** "Remix into my vault". Signed-out visitors are sent to sign-up by the server action and come back here. */
export function RemixButton({ slug, label = 'Remix into my vault', className }: { slug: string; label?: string; className?: string }) {
  const [state, action] = useActionState<RemixState, FormData>(remixStack, null);
  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      <Submit label={label} className={className} />
      {state && !state.ok && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{MESSAGE[state.error]}</p>}
    </form>
  );
}

/** Rendered by the fork page only when the visitor has a matching remix intent. Runs the remix once on arrival. */
export function AutoRemix({ slug }: { slug: string }) {
  const started = useRef(false);                       // React Strict Mode runs effects twice in dev
  const [state, run] = useActionState<RemixState, void>(async () => resumeRemix(slug), null);
  useEffect(() => { if (!started.current) { started.current = true; startTransition(() => run()); } }, [run]);
  return (
    <div role="status" className="text-sm text-[#4b5c53]">
      {state && !state.ok ? <>{MESSAGE[state.error]} <RemixButton slug={slug} label="Try again" className="mt-3 w-full rounded-xl bg-[#2fa66a] px-5 py-3 font-semibold text-white" /></> : 'Adding this stack to your vault…'}
    </div>
  );
}
