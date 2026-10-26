import type { HTMLAttributes } from 'react';

export function rowSelection(selected: boolean, select: () => void): HTMLAttributes<HTMLTableRowElement> & { 'data-selectable': boolean } {
  return {
    tabIndex: 0,
    'aria-selected': selected,
    'data-selectable': true,
    onClick: event => {
      if ((event.target as Element).closest('button, a, input, select, textarea, label')) return;
      select();
    },
    onKeyDown: event => {
      if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      select();
    },
  };
}
