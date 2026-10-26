import type { ReactNode } from 'react';
import { useReview } from '../context';

export function Glyph({ name, size = 18 }: { name: 'inventory' | 'requests' | 'transfer' | 'people' | 'setup' | 'scoring' | 'messages' | 'refresh' | 'check' | 'search' | 'chevron' | 'close'; size?: number }) {
  const paths = {
    inventory: 'M3 5h18v15H3zM3 10h18M8 3v4m8-4v4M7 14h3m4 0h3',
    requests: 'M6 3h12v18H6zM9 8h6m-6 4h6m-6 4h4',
    transfer: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    setup: 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    scoring: 'M4 20h16M7 16v-4m5 4V5m5 11V9',
    messages: 'M3 5h18v14H3zM3 6l9 7 9-7',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2',
    check: 'm5 12 4 4L19 6',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    chevron: 'm9 5 7 7-7 7',
    close: 'm6 6 12 12M6 18 18 6',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Status({ value, children }: { value: string; children?: ReactNode }) {
  return <span className={`work-status work-status--${value}`}>{children ?? value.replaceAll('_', ' ')}</span>;
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="work-search"><Glyph name="search" size={16} /><span className="sr-only">{placeholder}</span>
    <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
  </label>;
}

export function EmptyRows({ children }: { children: ReactNode }) {
  return <div className="work-empty"><Glyph name="search" size={24} /><h3>No matching records</h3><p>{children}</p></div>;
}


export function Capacity({ gameId, compact = false }: { gameId: string; compact?: boolean }) {
  const { snapshot } = useReview();
  const game = snapshot.catalog.find(g => g.id === gameId);
  if (!game) return null;
  const used = game.totalTickets - game.availableTickets;
  return <div className={compact ? 'work-capacity compact' : 'work-capacity'}>
    <div><span>{compact ? 'Available' : 'Ticket availability'}</span><strong>{game.availableTickets}<small> / {game.totalTickets}</small></strong></div>
    <div className="work-capacity-track" role="meter" aria-label="Allocated tickets" aria-valuemin={0} aria-valuemax={game.totalTickets || 1} aria-valuenow={used}>
      <span style={{ width: `${game.totalTickets ? used / game.totalTickets * 100 : 0}%` }} />
    </div>
    {!compact && <p>{used} allocated · {game.requestedTickets} tickets requested · {game.requestCount} {game.requestCount === 1 ? 'request' : 'requests'}</p>}
  </div>;
}
