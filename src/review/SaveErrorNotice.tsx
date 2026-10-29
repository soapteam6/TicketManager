import { Button } from './ui';
import { CopyErrorButton } from './CopyErrorButton';

export function SaveErrorNotice({ title, message, details, onDismiss }: {
  title: string;
  message: string;
  details: string;
  onDismiss: () => void;
}) {
  return <aside role="alert" aria-atomic="true"
    className="fixed bottom-4 right-4 left-4 z-[100] max-h-[50vh] overflow-y-auto rounded-xl border-2 border-rose-300 bg-white p-4 shadow-2xl sm:left-auto sm:w-[28rem]">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-2 min-w-0">
        <h2 className="font-semibold text-rose-900">{title}</h2>
        <p className="text-sm text-rose-900 whitespace-pre-wrap break-words">{message}</p>
        <CopyErrorButton details={details} />
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onDismiss} aria-label="Dismiss save error">Dismiss</Button>
    </div>
  </aside>;
}
