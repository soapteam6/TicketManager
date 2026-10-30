import { useState } from 'react';
import { useReview } from '../context';
import { helpArticles, releaseNotes, type HelpDestination } from '../helpContent';
import { Button } from '../ui';
import { EmptyRows, Glyph, Search } from './parts';

export function HelpWorkspace({ onNavigate }: { onNavigate: (destination: HelpDestination) => void }) {
  const { snapshot } = useReview();
  const [tab, setTab] = useState<'articles' | 'changes'>('articles');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase().trim());
  const articles = helpArticles.filter(article => (!article.coordinatorOnly || snapshot.persona.role === 'coordinator') && (!article.appAdminOnly || snapshot.persona.isAppAdmin))
    .filter(article => matches([article.title, article.summary, ...article.steps, article.note].join(' ')));
  const selected = articles.find(article => article.id === selectedId);
  const changes = releaseNotes.filter(note => matches([note.title, ...note.changes].join(' ')));
  return <section className="work-surface work-help-workspace">
    <div className="work-section-heading"><div><h2>Help</h2><p>Guides & app changes</p></div><div className="work-access-sections" role="group" aria-label="Help sections">
      <button type="button" aria-pressed={tab === 'articles'} onClick={() => { setTab('articles'); setQuery(''); }}>Articles</button>
      <button type="button" aria-pressed={tab === 'changes'} onClick={() => { setTab('changes'); setQuery(''); }}>What’s new</button></div></div>
    <div className="work-toolbar"><Search value={query} onChange={setQuery} placeholder={tab === 'articles' ? 'Search help articles' : 'Search app changes'} /><span className="work-toolbar-count">{tab === 'articles' ? `${articles.length} articles` : `${changes.length} updates`}</span></div>
    {tab === 'articles' ? <div className={`work-help-layout ${selected ? 'has-article' : ''}`}>
      <div className="work-help-list"><ul>{articles.map(article => <li key={article.id}><button type="button" aria-current={selected?.id === article.id ? 'true' : undefined} onClick={() => setSelectedId(article.id)}>
        <strong>{article.title}</strong><span>{article.summary}</span><Glyph name="chevron" size={16} />
      </button></li>)}</ul>{!articles.length && <EmptyRows>No articles match your search.</EmptyRows>}</div>
      {selected && <article className="work-help-article" aria-label={selected.title}><div className="work-inspector-heading"><span>Help article</span><button type="button" className="work-icon-button" aria-label="Close help article" onClick={() => setSelectedId('')}><Glyph name="close" /></button></div>
        <h3>{selected.title}</h3><p className="work-help-intro">{selected.summary}</p><ol>{selected.steps.map(step => <li key={step}>{step}</li>)}</ol>
        {selected.note && <p className="work-help-note">{selected.note}</p>}
        {selected.destination && <Button variant="secondary" onClick={() => onNavigate(selected.destination!)}>{selected.action}</Button>}
      </article>}
    </div> : <div className="work-change-scroll"><ol className="work-change-timeline">{changes.map(note => <li key={note.id}><time dateTime={note.date}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${note.date}T12:00:00Z`))}</time><article><h3>{note.title}</h3><ul>{note.changes.map(change => <li key={change}>{change}</li>)}</ul></article></li>)}</ol>{!changes.length && <EmptyRows>No app changes match your search.</EmptyRows>}</div>}
  </section>;
}
