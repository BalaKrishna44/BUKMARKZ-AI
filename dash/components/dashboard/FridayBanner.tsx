'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sparkles, Layers, ArrowRight, X, Share2, BrainCircuit, Zap, Flame, MousePointerClick } from 'lucide-react';
import { dayKey, shouldShowBanner, SHARE_TEXT } from '@/lib/friday/banner';

interface FridayBannerProps {
  /** Real count of never-opened saves from your data. Omit or 0 to hide the second button. */
  unreadSavesCount?: number;
  /** The signed-in user's referral link (https://bukmarkz.com/signup?ref=...). Omit to share without a link. */
  shareUrl?: string;
  onTakeQuiz?: () => void;
}
const KEY = 'bukmarkz.friday.dismissed';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: the banner simply returns on reload */ } };

/**
 * Friday Vault After-Hours banner for the dashboard.
 * A web page cannot read or close your browser tabs, and Chrome only lets the extension ask for that permission from its own popup,
 * so the button here shows the one-click steps instead of pretending to flush. No tab counts are shown: the page does not know them.
 */
export default function FridayBanner({ unreadSavesCount = 0, shareUrl, onTakeQuiz }: FridayBannerProps) {
  const [visible, setVisible] = useState(false);          // decided after mount: it depends on the viewer's local clock, so SSR renders nothing
  const [steps, setSteps] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => { setVisible(shouldShowBanner(new Date(), window.location.search, read())); }, []);
  const dismiss = () => { write(dayKey(new Date())); setVisible(false); };

  async function share() {
    const text = shareUrl ? `${SHARE_TEXT} ${shareUrl}` : SHARE_TEXT;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setShareNote('Copied. Paste it to a coworker.');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;                // they closed the share sheet: not an error
      setShareNote('Could not copy. Select the skit and share it by hand.');
    }
    setTimeout(() => setShareNote(null), 3000);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.section
          role="region" aria-label="Friday Vault After-Hours"
          initial={reduce ? false : { opacity: 0, y: -20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="relative my-6 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl backdrop-blur-xl md:p-8"
        >
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-teal-500/10 blur-3xl" />

          <div className="flex items-center justify-between border-b border-slate-800/80 pb-6">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Friday Vault After-Hours</span>
              <span className="hidden text-xs text-slate-400 sm:inline-block">Weekend readiness</span>
            </div>
            <button type="button" onClick={dismiss} aria-label="Dismiss for today" className="rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"><X className="h-4 w-4" aria-hidden /></button>
          </div>

          <div className="grid grid-cols-1 items-center gap-8 pt-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <div className="space-y-3.5 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-inner md:p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/20"><Zap className="h-4 w-4 text-emerald-400" aria-hidden /></span>
                  <div className="space-y-1"><span className="text-xs font-bold text-emerald-400">Markz</span>
                    <p className="text-sm leading-relaxed text-slate-200">&ldquo;Buk! I found the ultimate shortcut to close <span className="font-semibold text-amber-400">all my open tabs</span> before the weekend!&rdquo;</p></div>
                </div>
                <div className="flex items-start gap-3 border-t border-slate-800/60 pt-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal-500/40 bg-teal-500/20"><BrainCircuit className="h-4 w-4 text-teal-300" aria-hidden /></span>
                  <div className="space-y-1"><span className="text-xs font-bold text-teal-300">Buk</span>
                    <p className="text-sm leading-relaxed text-slate-300">&ldquo;Fascinating, Markz. Did you save them first&hellip; or did your battery just die again?&rdquo;</p></div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
                <span aria-live="polite">{shareNote ?? 'Enjoyed the skit?'}</span>
                <button type="button" onClick={() => void share()} className="flex items-center gap-1.5 text-slate-300 transition-colors hover:text-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"><Share2 className="h-3.5 w-3.5" aria-hidden /> Share with a coworker</button>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 lg:col-span-5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Flame className="h-4 w-4 text-amber-400" aria-hidden /> Friday Vault clean-up</h2>
                <p className="mt-1 text-xs text-slate-400">Don&apos;t carry tab-debt into Saturday. One click saves the whole window as a session and closes the clutter.</p>
              </div>
              {!steps ? (
                <div className="space-y-3">
                  <button type="button" onClick={() => setSteps(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-500/10 transition-all hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"><Layers className="h-4 w-4" aria-hidden /> Flush my open tabs to Vault</button>
                  {unreadSavesCount > 0 && onTakeQuiz && (
                    <button type="button" onClick={onTakeQuiz} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-700">Review {unreadSavesCount} unread weekend read{unreadSavesCount === 1 ? '' : 's'} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
                  )}
                </div>
              ) : (
                <ol className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-slate-200">
                  <li className="flex gap-2"><MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /><span>Open the <b>Bukmarkz</b> icon in your browser toolbar (pin it from the puzzle-piece menu if you don&apos;t see it).</span></li>
                  <li className="pl-6">Press <b>Flush session</b>, then <b>Save and close</b>.</li>
                  <li className="pl-6 text-slate-400">Pinned tabs and this tab stay open. You get a link to the saved session.</li>
                </ol>
              )}
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
