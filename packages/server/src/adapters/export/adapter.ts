export interface SeasonTrackerRow {
  team: string;
  gameDate: string;
  opponent: string;
  promotions: string;
  requesterName: string;
  company: string;
  beneficiaryType: string;
  quantity: number;
  seatLabel: string;
  priorityScore: number | null;
  requestStatus: string;
  assignmentStatus: string; // drives the red-cell convention when 'transferred'
  attended: string;
  businessGenerated: number | null;
  salesRep: string;
  followUpNotes: string;
}

export interface ExportAdapter {
  exportSeasonTracker(title: string, rows: SeasonTrackerRow[]): Promise<Buffer>;
  // Real 'onedrive' impl would reuse buildWorkbook and PUT to Graph, returning a webUrl.
}
