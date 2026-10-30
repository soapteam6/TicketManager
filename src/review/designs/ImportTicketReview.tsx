import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useReview } from '../context';
import { CrmBeneficiaryPicker } from '../CrmBeneficiaryPicker';
import type { CrmBeneficiary } from '../types';
import type { DiscoveredGame, ImportTicketRow } from '../scheduleDiscovery';
import { Button, Field, Select, TextInput } from '../ui';

export function ImportTicketReview({ game, onChange }: { game: DiscoveredGame; onChange: (rows: ImportTicketRow[]) => void }) {
  const { snapshot, busy } = useReview();
  const [open, setOpen] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<number>();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'saved' | 'crm'>('saved');
  const [crm, setCrm] = useState<CrmBeneficiary[]>([]);
  const [matching, setMatching] = useState(false);
  const rows = game.ticketRows ?? [];
  const ticket = rows.find(t => t.ticketNumber === ticketNumber);
  const people = snapshot.options.filter(c => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(query.toLowerCase())).slice(0, 25);
  function update(number: number, patch: Partial<ImportTicketRow>) { onChange(rows.map(row => row.ticketNumber === number ? { ...row, ...patch } : row)); }
  function choose(contactId?: string, contactName?: string, crmContact?: CrmBeneficiary) {
    if (!ticket) return;
    onChange(rows.map(row => row.ticketNumber === ticket.ticketNumber || matching && !!ticket.rawName.trim() && row.rawName.trim().toLowerCase() === ticket.rawName.trim().toLowerCase()
      ? { ...row, contactId, contactName, crmContact } : row));
    setTicketNumber(undefined); setCrm([]);
  }
  if (!rows.length) return null;
  return <>
    <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Review {rows.length} tickets</Button>
    <Modal open={open} onClose={() => { setOpen(false); setTicketNumber(undefined); }} title={`Review tickets — ${game.title}`} size="lg">
      <div className="max-h-[65vh] overflow-y-auto space-y-4" aria-label="Imported ticket review">
        <p className="text-sm">{game.sourceFile}{game.sourceLocation ? ` · ${game.sourceLocation}` : ''}</p>
        {ticket ? <>
          <Button type="button" size="sm" variant="secondary" onClick={() => setTicketNumber(undefined)}>Back to tickets</Button>
          <p className="text-sm"><strong>Ticket {ticket.ticketNumber}: {ticket.rawName || 'Unnamed recipient'}</strong><br />{[ticket.company, ticket.email, ticket.phone, ticket.sourceLocation].filter(Boolean).join(' · ')}</p>
          <Field label="Find recipient in"><Select value={source} onChange={e => { setSource(e.target.value as 'saved' | 'crm'); setCrm([]); }}><option value="saved">Employee / saved contact register</option><option value="crm">CRM customer contacts</option></Select></Field>
          {!!ticket.rawName && <label className="flex gap-2 text-sm"><input type="checkbox" checked={matching} onChange={e => setMatching(e.target.checked)} />Use this person for matching source names in this game</label>}
          {source === 'crm' ? <><CrmBeneficiaryPicker selected={crm} onChange={people => setCrm(people.slice(-1))} /><Button type="button" disabled={crm.length !== 1 || busy} onClick={() => choose(undefined, crm[0].name, crm[0])}>Use selected CRM contact</Button></> : <>
            <Field label="Search name, email or business"><TextInput aria-label="Search import recipients" value={query} onChange={e => setQuery(e.target.value)} /></Field>
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100" aria-label="Import recipient results">{people.map(person => <button key={person.id} type="button" className="block w-full p-3 text-left text-sm hover:bg-slate-50" onClick={() => choose(person.id, person.name)}><strong>{person.name}</strong><span className="block text-xs text-slate-600">{person.email || 'No email recorded'} · {person.company}</span></button>)}</div>
            {!people.length && <p className="text-sm">No matching contacts. Try CRM customer contacts or add a contact to the register first.</p>}
          </>}
        </> : <>
          <p className="text-sm">Confirm availability and select the real recipient for allocated tickets. Names from the file are hints, not identity matches.</p>
          {rows.map(row => <section key={row.ticketNumber} className="space-y-2 rounded border border-slate-200 p-3 text-sm" aria-label={`Imported ticket ${row.ticketNumber}`}>
            <strong>Ticket {row.ticketNumber}</strong><p>{row.rawName || 'No recipient in source'}{row.company ? ` · ${row.company}` : ''}</p>
            <p className="text-xs text-slate-600">Source: {row.sourceStatus || 'Unclear'} · {row.sourceLocation || game.sourceLocation}</p>
            {row.note && <p className="text-xs text-amber-800">{row.note}</p>}
            {!game.sourceLocation && <Field label="Source sheet / row"><TextInput value={row.sourceLocation} onChange={e => update(row.ticketNumber, { sourceLocation: e.target.value })} maxLength={200} /></Field>}
            <Field label="Ticket status"><Select value={row.resolution} onChange={e => update(row.ticketNumber, { resolution: e.target.value as ImportTicketRow['resolution'] })}>
              <option value="">Needs review</option><option value="available">Available</option><option value="allocated">Allocated</option><option value="transferred">Already transferred</option>
            </Select></Field>
            {row.resolution && row.resolution !== 'available' && <div className="flex items-center justify-between gap-3"><span>{row.contactName || 'Select the real recipient'}</span><Button type="button" size="sm" variant="secondary" onClick={() => { setTicketNumber(row.ticketNumber); setQuery(row.rawName.replace(/\s*x\s*\d+\s*$/i, '')); setSource('saved'); setCrm([]); setMatching(false); }}>{row.contactName ? 'Change recipient' : 'Choose recipient'}</Button></div>}
          </section>)}
          <Button type="button" onClick={() => setOpen(false)}>Done reviewing</Button>
        </>}
      </div>
    </Modal>
  </>;
}
