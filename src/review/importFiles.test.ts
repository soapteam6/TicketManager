import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readImportFiles } from './importFiles';
import { discoveredGameIssues, parseScheduleDiscovery } from './scheduleDiscovery';
import { MockReviewProvider } from './provider';
import { GUID } from './fixtures';

const source = { name: 'Tracker.xlsb.xlsx', annotationId: GUID(30, 1), sha256: 'abc', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 100 };
const request = { query: '', seasonId: '', ticketsPerEvent: 0, homeOnly: true, files: [source] };
function result(patch: Record<string, unknown> = {}) {
  return { stop_reason: 'end_turn', uploads: [{ annotationId: source.annotationId, fileId: 'file_example' }], content: [{ type: 'text', text: JSON.stringify({ team: 'Example team', season: '2027', timezone: 'America/Los_Angeles', seasonStart: '2027-01-01', seasonEnd: '2027-12-31', warnings: [], games: [{ title: 'File opponent', localDate: '2027-07-04', localTime: '19:00', startAt: '2027-07-05T02:00:00Z', sourceFile: source.name, sourceLocation: 'Tickets, row 2', home: null, tickets: 2, ...patch }] }) }] };
}
describe('AI Import file input', () => {
  it('passes a workbook with arbitrary layout, formulas and formatting intact', async () => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Tickets');
    sheet.getCell('A1').value = new Date('2027-07-04T00:00:00Z'); sheet.getCell('A1').numFmt = 'mm/dd/yyyy';
    sheet.getCell('A2').value = 'Gary'; sheet.getCell('A2').font = { strike: true };
    sheet.getCell('J2').value = 'Available'; sheet.getCell('G1').value = { formula: 'COUNTIF(J2:J5,"Available")', result: 4 };
    const bytes = await book.xlsx.writeBuffer();
    const files = await readImportFiles([new File([bytes], source.name)]);
    expect(files[0].mediaType).toContain('spreadsheetml');
    const restored = new ExcelJS.Workbook(); await restored.xlsx.load(Uint8Array.from(atob(files[0].data), c => c.charCodeAt(0)).buffer);
    expect(restored.worksheets[0].getCell('A2').value).toBe('Gary');
    expect(restored.worksheets[0].getCell('A2').font.strike).toBe(true);
    expect(restored.worksheets[0].getCell('G1').value).toMatchObject({ formula: 'COUNTIF(J2:J5,"Available")' });
  });
  it('rejects empty, duplicate, unsafe-named and oversized uploads without dropping existing files', async () => {
    await expect(readImportFiles([new File([], 'empty.xlsx')])).rejects.toThrow('empty');
    await expect(readImportFiles([new File(['a'], 'same.txt'), new File(['b'], 'SAME.txt')])).rejects.toThrow('already attached');
    await expect(readImportFiles([new File(['a'], 'bad"name.txt')])).rejects.toThrow('file name');
    await expect(readImportFiles([new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.bin')])).rejects.toThrow('4 MB');
    await expect(readImportFiles(Array.from({ length: 6 }, (_, i) => new File(['a'], `${i}.txt`)))).rejects.toThrow('5 files');
  });
  it('prepares a file without typed text and returns metadata rather than uploaded bytes', async () => {
    const provider = new MockReviewProvider();
    const upload = (await readImportFiles([new File(['sample'], 'sample.txt')]))[0];
    const job = await provider.startScheduleSearch('coordinator', { query: '', seasonId: '', ticketsPerEvent: 0, homeOnly: true, files: [upload] }, 'file-test');
    expect(job.request.files![0]).toMatchObject({ name: 'sample.txt', size: 6 });
    expect(job.request.files![0]).not.toHaveProperty('data');
    await expect(provider.startScheduleSearch('employee', { query: '', seasonId: '', ticketsPerEvent: 0, homeOnly: true, files: [upload] }, 'forbidden')).rejects.toThrow('Coordinator');
  });
});
describe('uploaded source and recipient review', () => {
  it('accepts attested uploaded files without a web search and keeps per-game ticket quantities', () => {
    const preview = parseScheduleDiscovery(result(), request);
    expect(preview.sources).toEqual([{ url: '', title: source.name, fileName: source.name }]);
    expect(preview.games[0]).toMatchObject({ sourceVerified: true, tickets: 2, ticketsKnown: true, startAt: '2027-07-05T02:00:00.000Z', selected: true });
    expect(discoveredGameIssues(preview.games[0], [], true)).toEqual([]);
  });
  it('rejects fabricated uploaded source names and missing upload attestations', () => {
    expect(parseScheduleDiscovery(result({ sourceFile: 'invented.xlsx' }), request).games[0].sourceVerified).toBe(false);
    const raw = result(); raw.uploads = [];
    expect(() => parseScheduleDiscovery(raw, request)).toThrow('uploaded files');
  });
  it('imports owned inventory without requiring historical recipient or status matching', () => {
    const game = parseScheduleDiscovery(result({ alreadyAllocated: true, ticketRows: [
      { ticketNumber: 1, rawName: 'Gary', status: 'available', sourceLocation: 'Tickets A3' },
      { ticketNumber: 2, rawName: 'Unknown holder', status: 'allocated', sourceLocation: 'Tickets F4' },
    ] }), request).games[0];
    expect(game).toMatchObject({ selected: true, tickets: 2 });
    expect(game).not.toHaveProperty('ticketRows');
    expect(discoveredGameIssues(game, [], true)).toEqual([]);
  });
  it('uses owned quantities independently of inconsistent old attendee rows', () => {
    const game = parseScheduleDiscovery(result({ tickets: 4, ticketRows: [{ ticketNumber: 1, status: 'allocated' }, { ticketNumber: 1, status: 'available' }] }), request).games[0];
    expect(game.tickets).toBe(4);
    expect(discoveredGameIssues(game, [], true)).toEqual([]);
  });
});
describe('reviewed prior-allocation import', () => {
  const command = { type: 'importSchedule' as const, seasonId: '', csv: 'date,time,title,tickets,kind\n2026-01-01,03:00,Historical file event,2,event', importedAllocations: [{ rowIndex: 0, ticketNumber: 1, status: 'transferred' as const, contactId: GUID(4, 5), sourceFile: 'tracker.xlsx', sourceLocation: 'Tickets row 3', sourceNote: 'Gary, manually resolved to the real person' }] };
  it('imports past events and reviewed allocations atomically without inventing attendance or original requesters', async () => {
    const p = new MockReviewProvider(() => Date.parse('2026-10-30T12:00:00Z'));
    await p.execute('coordinator', command);
    const snapshot = p.snapshot('coordinator'), game = snapshot.catalog.find(g => g.title === 'Historical file event')!;
    expect(game).toMatchObject({ release: 'private', totalTickets: 2, availableTickets: 1, requestingPeople: 0 });
    const allocation = snapshot.allocations!.find(a => a.gameId === game.id)!;
    expect(allocation).toMatchObject({ status: 'transferred', contactId: GUID(4, 5), outcome: 'unknown' });
    expect(snapshot.requests.find(r => r.gameId === game.id)).toMatchObject({ requesterName: 'Imported allocation', status: 'fulfilled' });
  });
  it('rejects unresolved, inactive or duplicate recipients and rolls back the event too', async () => {
    const p = new MockReviewProvider(() => Date.parse('2026-10-30T12:00:00Z')), before = p.snapshot('coordinator');
    for (const allocations of [[{ ...command.importedAllocations[0], contactId: '' }], [{ ...command.importedAllocations[0], contactId: GUID(4, 6) }], [command.importedAllocations[0], command.importedAllocations[0]]]) {
      await expect(p.execute('coordinator', { ...command, importedAllocations: allocations })).rejects.toThrow();
      expect(p.snapshot('coordinator')).toEqual(before);
    }
    await expect(p.execute('rep', command)).rejects.toThrow('Coordinator');
  });
});
