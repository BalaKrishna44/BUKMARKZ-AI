/** First-run checklist: pure logic. The goal is time-to-value: first saved links -> first answer, in about a minute. */
export interface OnboardingState { items: number; dismissed: boolean; extension: boolean; asked: boolean; remixed: boolean }
export type StepId = 'import_or_save' | 'ask' | 'extension' | 'stack';
export interface Step { id: StepId; title: string; hint: string; done: boolean; href: string }
export interface Checklist { steps: Step[]; doneCount: number; total: number; next: Step | null; complete: boolean; visible: boolean }

/** Asking needs something to ask about: below this many links, Ask is shown as locked behind step 1. */
export const MIN_ITEMS_FOR_ASK = 5;

export function computeChecklist(s: OnboardingState): Checklist {
  const items = Number.isFinite(s.items) && s.items > 0 ? Math.floor(s.items) : 0;
  const steps: Step[] = [
    { id: 'import_or_save', title: 'Add your first links', hint: `Import from Raindrop, Pocket or your browser, or save a few (${Math.min(items, MIN_ITEMS_FOR_ASK)}/${MIN_ITEMS_FOR_ASK}).`, done: items >= MIN_ITEMS_FOR_ASK, href: '/dashboard/import' },
    { id: 'ask', title: 'Ask your vault a question', hint: items >= MIN_ITEMS_FOR_ASK ? 'Switch the search bar to Ask and try a real question.' : `Add ${MIN_ITEMS_FOR_ASK - items} more link${MIN_ITEMS_FOR_ASK - items === 1 ? '' : 's'} first.`, done: s.asked, href: '/dashboard?mode=ask' },
    { id: 'extension', title: 'Install the browser extension', hint: 'Save any page with Ctrl/Cmd+Shift+S.', done: s.extension, href: '/extension' },
    { id: 'stack', title: 'Remix a starter Stack', hint: 'Copy a ready-made reading list into your vault in one click.', done: s.remixed, href: '/dashboard/starter-stacks' },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const complete = doneCount === steps.length;
  const next = steps.find((x) => !x.done && !(x.id === 'ask' && items < MIN_ITEMS_FOR_ASK)) ?? steps.find((x) => !x.done) ?? null;
  return { steps, doneCount, total: steps.length, next, complete, visible: !s.dismissed && !complete };
}
