// A home game extracted from a team's official site by the AI schedule importer.
export interface ExtractedGame {
  gameDate: string; // ISO 8601, includes start time when known (e.g. 2026-10-14T19:00:00)
  opponent: string;
  promotions?: string | null;
}

export interface ScheduleImportPreview {
  games: ExtractedGame[];
  provider: 'claude';
  sourceUrl: string;
}
