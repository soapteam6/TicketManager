import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

export function CopyErrorButton({ details }: { details: string }) {
  return <CopyErrorControl key={details} details={details} />;
}

function CopyErrorControl({ details }: { details: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current); setCopied(false);
    let success = false;
    try { await navigator.clipboard.writeText(details); success = true; }
    catch {
      // Embedded Power Apps hosts can deny the asynchronous Clipboard API.
      const previous = document.activeElement;
      const input = document.createElement('textarea');
      input.value = details;
      input.setAttribute('aria-label', 'Copying error details');
      input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
      document.body.append(input);
      input.select();
      try { success = document.execCommand('copy'); } catch { /* Offer manual copy. */ }
      finally { input.remove(); if (previous instanceof HTMLElement) previous.focus(); }
    }
    if (success) {
      setManual(false); setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } else setManual(true);
  }
  return <div className="min-w-0 space-y-2">
    <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}><span aria-live="polite">{copied ? 'Copied' : 'Copy error'}</span></Button>
    {manual && <label className="block text-sm font-normal text-slate-700">Automatic copy is unavailable. Select and copy these details:
      <textarea aria-label="Error details to copy" readOnly rows={6} value={details} onFocus={e => e.target.select()}
        ref={input => { if (input) { input.focus(); input.select(); } }}
        className="mt-2 block w-full rounded border border-slate-300 p-2 font-mono text-xs" />
    </label>}
  </div>;
}
