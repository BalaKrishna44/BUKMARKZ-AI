'use client';
import { useEffect, useRef, useState } from 'react';
import ImportExportModal from './ImportExportModal';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Mount once (e.g. in the app layout). Drag a bookmarks file anywhere over the window and a
 * "Drop to import" overlay appears; dropping opens the import modal with that file already chosen.
 * Also stops the browser from navigating away to the file if it is dropped slightly off-target.
 * `openRef` lets a toolbar button open the same modal: <button onClick={() => openRef.current?.()}>.
 */
export default function GlobalImportDrop({ onImported, openRef }: { onImported?: () => void; openRef?: { current: (() => void) | null } }) {
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const depth = useRef(0);
  const openRef_ = useRef(open); openRef_.current = open;

  useEffect(() => { if (openRef) openRef.current = () => { setFile(null); setOpen(true); }; return () => { if (openRef) openRef.current = null; }; }, [openRef]);

  useEffect(() => {
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; if (!openRef_.current) setOver(true); };
    const overFn = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; if (--depth.current <= 0) { depth.current = 0; setOver(false); } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth.current = 0; setOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f && !openRef_.current) { setFile(f); setOpen(true); } // inside the open modal its own dropzone handles it
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', overFn); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);

  return (
    <>
      {over && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-[#05070d]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-400/5 px-12 py-10 text-center">
            <p className="text-lg font-semibold text-white">Drop to import bookmarks</p>
            <p className="mt-1 text-sm text-slate-400">HTML, CSV or JSON from Chrome, Firefox, Raindrop, Pocket and more</p>
          </div>
        </div>
      )}
      <ImportExportModal open={open} initialFile={file} onClose={() => { setOpen(false); setFile(null); }} onImported={onImported} />
    </>
  );
}
