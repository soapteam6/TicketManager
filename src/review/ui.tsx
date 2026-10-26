import type { FormEvent, ReactNode } from 'react';
import { Field, Select, TextArea, TextInput } from '../components/Field';
import { Button } from '../components/Button';
import { useReview } from './context';
export { Field, Select, TextArea, TextInput, Button };
export type Submit = FormEvent<HTMLFormElement>;
export function Panel({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-600">
      {children}
    </p>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  );
}

export function FormError() {
  const { error, busy } = useReview();
  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900"
        >
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm">
          Saving local change…
        </p>
      )}
    </>
  );
}
