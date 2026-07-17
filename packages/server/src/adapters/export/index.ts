import { env } from '../../env.js';
import type { ExportAdapter } from './adapter.js';
import { ExcelJsExportAdapter } from './xlsx.js';

export function getExportAdapter(): ExportAdapter {
  switch (env.EXPORT_MODE) {
    case 'local':
    default:
      return new ExcelJsExportAdapter();
  }
}

export * from './adapter.js';
