import ExcelJS from 'exceljs';
import type { ExportAdapter, SeasonTrackerRow } from './adapter.js';

const COLUMNS: Array<{ header: string; key: keyof SeasonTrackerRow; width: number }> = [
  { header: 'Team', key: 'team', width: 22 },
  { header: 'Game Date', key: 'gameDate', width: 14 },
  { header: 'Opponent', key: 'opponent', width: 22 },
  { header: 'Promotions', key: 'promotions', width: 18 },
  { header: 'Requester', key: 'requesterName', width: 20 },
  { header: 'Company', key: 'company', width: 20 },
  { header: 'Type', key: 'beneficiaryType', width: 10 },
  { header: 'Qty', key: 'quantity', width: 6 },
  { header: 'Seat', key: 'seatLabel', width: 16 },
  { header: 'Priority', key: 'priorityScore', width: 10 },
  { header: 'Request Status', key: 'requestStatus', width: 16 },
  { header: 'Assignment', key: 'assignmentStatus', width: 14 },
  { header: 'Attended', key: 'attended', width: 12 },
  { header: 'Business ($)', key: 'businessGenerated', width: 14 },
  { header: 'Sales Rep', key: 'salesRep', width: 18 },
  { header: 'Follow-up Notes', key: 'followUpNotes', width: 30 },
];

// Shared workbook builder — reused by the local export today and a OneDrive sink later.
export function buildWorkbook(title: string, rows: SeasonTrackerRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AIS Ticket Concierge';
  const ws = wb.addWorksheet(title.slice(0, 31));

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const row of rows) {
    const added = ws.addRow(row);
    // Their convention: transferred tickets are highlighted red.
    if (row.assignmentStatus === 'transferred') {
      added.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        cell.font = { color: { argb: 'FF9C0006' } };
      });
    }
  }
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
  return wb;
}

export class ExcelJsExportAdapter implements ExportAdapter {
  async exportSeasonTracker(title: string, rows: SeasonTrackerRow[]): Promise<Buffer> {
    const wb = buildWorkbook(title, rows);
    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
