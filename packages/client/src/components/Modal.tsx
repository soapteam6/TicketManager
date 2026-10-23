import { useEffect, useId, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const targets = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []);
    (targets()[0] ?? dialog)?.focus();
    const handle = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role=dialog]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const items = targets();
        const first = items[0]; const last = items[items.length - 1];
        if (!first) { e.preventDefault(); dialog?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handle);
    return () => { window.removeEventListener('keydown', handle); previous?.focus(); };
  }, [open]);
  return ref;
}

const SIZE: Record<NonNullable<OverlayProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: OverlayProps) {
  const dialogRef = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
        role="dialog"
        aria-modal="true"
        className={clsx('relative z-10 my-8 w-full rounded-xl bg-white shadow-xl', SIZE[size])}
      >
        {(title || description) && (
          <div className="border-b border-slate-200 px-6 py-4">
            <button type="button" onClick={onClose} className="float-right rounded p-1 text-sm hover:bg-slate-100" aria-label="Close dialog">Close</button>
            {title && <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// A right-side drawer, same API shape as Modal.
export function Drawer({ open, onClose, title, description, children, footer, size = 'lg' }: OverlayProps) {
  const dialogRef = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;

  const width: Record<NonNullable<OverlayProps['size']>, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-xl',
    xl: 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        aria-labelledby={title ? titleId : undefined}
        role="dialog"
        aria-modal="true"
        className={clsx(
          'absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl',
          width[size]
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
            <div>
              {title && <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>}
              {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
