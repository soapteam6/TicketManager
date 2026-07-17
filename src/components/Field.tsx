import clsx from 'clsx';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      {label && (
        <span className="label">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('input', props.className)} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={clsx('input pr-8', props.className)}>
      {children}
    </select>
  );
}

// Convenience: build <option>s from an enum tuple with title-cased labels.
export function EnumOptions({
  values,
  includeBlank,
  blankLabel = 'All',
  labels,
}: {
  values: readonly string[];
  includeBlank?: boolean;
  blankLabel?: string;
  labels?: Record<string, string>;
}) {
  return (
    <>
      {includeBlank && <option value="">{blankLabel}</option>}
      {values.map((v) => (
        <option key={v} value={v}>
          {labels?.[v] ?? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </option>
      ))}
    </>
  );
}
