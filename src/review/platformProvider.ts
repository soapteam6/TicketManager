import type { GameRankingResult } from '../domain/scoring-types';
import { ReviewError } from './provider';
import { rankReviewState } from './ranking';
import { previewScheduleCsv } from './schedule';
import { createSnapshotLoader } from './workspaceLoading';
import type { CommandResult, PersonaKey, ReviewCommand, ReviewProvider, ReviewSnapshot, ReviewState, ScheduleSearchJob, ScheduleSearchRequest } from './types';

export interface PlatformResponse {
  revision: number;
  serverNow: string;
  snapshot: ReviewSnapshot;
  state?: ReviewState;
  result: CommandResult;
}
export type PlatformTransport = (payload: Record<string, unknown>) => Promise<PlatformResponse>;
export type ScheduleSearchTransport = (payload: Record<string, unknown>) => Promise<ScheduleSearchJob>;

// Authenticated projections and every mutation come from the server. A persona key
// is kept in the UI interface for demo compatibility; it is never sent to Dataverse.
export class DataverseReviewProvider implements ReviewProvider {
  readonly mode = 'dataverse' as const;
  private listeners = new Set<() => void>();
  private version = 0;
  private current: PlatformResponse;
  private transport: PlatformTransport;
  private loadSnapshot: () => Promise<PlatformResponse>;
  private searchTransport?: ScheduleSearchTransport;
  constructor(transport: PlatformTransport, initial: PlatformResponse, searchTransport?: ScheduleSearchTransport) {
    this.transport = transport;
    this.loadSnapshot = createSnapshotLoader(transport);
    this.current = initial;
    this.searchTransport = searchTransport;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  revision = () => this.version;
  refresh = () => { this.version++; for (const listener of this.listeners) listener(); };
  snapshot = (): ReviewSnapshot => structuredClone({ ...this.current.snapshot, serverNow: this.current.serverNow });
  async reload() {
    this.accept(await this.loadSnapshot());
  }
  private accept(response: PlatformResponse) {
    // A read that started before a save must not overwrite that save's response.
    if (response.revision < this.current.revision) return;
    this.current = response;
    this.refresh();
  }
  async execute(_key: PersonaKey, command: ReviewCommand): Promise<CommandResult> {
    // No automatic retries: ambiguous network failures must be reconciled by refresh.
    // Each call carries an idempotency receipt and the revision the coordinator saw.
    try {
      const response = await this.transport({ operation: 'command', command, revision: this.current.revision, operationId: crypto.randomUUID() });
      this.accept(response);
      return response.result;
    } catch (error) {
      try { await this.reload(); } catch { /* Preserve the original command failure. */ }
      throw error;
    }
  }
  private coordinator() {
    if (this.current.snapshot.persona.role !== 'coordinator') throw new ReviewError('forbidden', 'Coordinator permission is required.');
  }
  previewSchedule(_key: PersonaKey, csv: string) { this.coordinator(); return previewScheduleCsv(csv); }
  async startScheduleSearch(_key: PersonaKey, request: ScheduleSearchRequest, jobId: string) {
    this.coordinator();
    if (!this.searchTransport) throw new Error('Schedule search is unavailable.');
    return this.searchTransport({ operation: 'scheduleSearchStart', request, jobId });
  }
  async getScheduleSearch(_key: PersonaKey, jobId: string) {
    this.coordinator();
    if (!this.searchTransport) throw new Error('Schedule search is unavailable.');
    return this.searchTransport({ operation: 'scheduleSearchGet', jobId });
  }
  availability(): string {
    this.coordinator();
    const now = Date.parse(this.current.serverNow);
    const games = this.current.snapshot.catalog.filter(g => g.released && g.status === 'scheduled' && Date.parse(g.gameDate) > now && g.availableTickets > 0);
    return `${games.reduce((n, g) => n + g.availableTickets, 0)} tickets available across ${games.length} released events. Express interest in the app; a coordinator decides allocations. Requests do not guarantee tickets.`;
  }
  rank(_key: PersonaKey, gameId: string): GameRankingResult {
    this.coordinator();
    if (!this.current.state) throw new Error('Dataverse did not return coordinator scoring data.');
    return rankReviewState(this.current.state, gameId, Date.parse(this.current.serverNow));
  }
}
