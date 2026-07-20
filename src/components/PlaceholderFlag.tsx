import clsx from 'clsx';

// Inline "not done yet" marker — a small debug/wrench icon that flags UI backed by
// placeholder (non-real) data. Hover shows why. Reusable anywhere: drop it next to any
// value, label, or control that isn't wired to a real source yet.
//   <PlaceholderFlag note="Season-ticket holders isn't modeled yet" />
export function PlaceholderFlag({ note, className }: { note?: string; className?: string }) {
  const title = note ? `Not done yet — ${note}` : 'Not done yet — placeholder data';
  return (
    <span
      title={title}
      aria-label={title}
      className={clsx(
        'inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-md bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200',
        className
      )}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
        />
      </svg>
    </span>
  );
}
