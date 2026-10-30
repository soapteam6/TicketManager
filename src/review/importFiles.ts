import type { ImportFileUpload } from './types';

export const MAX_IMPORT_FILES = 5;
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const mediaTypes: Record<string, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export async function readImportFiles(incoming: File[], existing: ImportFileUpload[] = []): Promise<ImportFileUpload[]> {
  if (existing.length + incoming.length > MAX_IMPORT_FILES) throw new Error(`Choose up to ${MAX_IMPORT_FILES} files.`);
  if (existing.reduce((n, f) => n + f.size, 0) + incoming.reduce((n, f) => n + f.size, 0) > MAX_IMPORT_BYTES) throw new Error('Choose files totalling 4 MB or less.');
  const names = new Set(existing.map(f => f.name.toLowerCase()));
  for (const file of incoming) {
    if (!file.size) throw new Error(`${file.name} is empty.`);
    if (!file.name || file.name.length > 160 || /[\\/"]/.test(file.name) || [...file.name].some(c => c.charCodeAt(0) < 32)) throw new Error('Use a file name without folders, quotes or control characters (up to 160 characters).');
    if (names.has(file.name.toLowerCase())) throw new Error(`A file named ${file.name} is already attached. Rename one of them first.`);
    names.add(file.name.toLowerCase());
  }
  const files = await Promise.all(incoming.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const mediaType = file.type || mediaTypes[file.name.split('.').pop()!.toLowerCase()] || 'application/octet-stream';
    return { name: file.name, mediaType, size: bytes.length, data: btoa(binary) };
  }));
  return [...existing, ...files];
}
