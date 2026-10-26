import clsx from 'clsx';
import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

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
  const labelId = useId(),
    hintId = useId();
  const control =
    isValidElement<{
      'aria-labelledby'?: string;
      'aria-describedby'?: string;
    }>(children) &&
    ((typeof children.type === 'string' &&
      ['input', 'select', 'textarea'].includes(children.type)) ||
      children.type === TextInput ||
      children.type === TextArea ||
      children.type === Select)
      ? cloneElement(children, {
          'aria-labelledby':
            children.props['aria-labelledby'] ?? (label ? labelId : undefined),
          'aria-describedby':
            children.props['aria-describedby'] ?? (hint ? hintId : undefined),
        })
      : children;
  return (
    <label className={clsx('block', className)}>
      {label && (
        <span className="label">
          <span id={labelId}>{label}</span>
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-rose-500">
              *
            </span>
          )}
        </span>
      )}
      {control}
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-slate-400">
          {hint}
        </span>
      )}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('input', props.className)} />;
}

export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
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
          {labels?.[v] ??
            v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </option>
      ))}
    </>
  );
}
