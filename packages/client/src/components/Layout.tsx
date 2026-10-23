import { NavLink, Outlet } from 'react-router-dom';
import { useAuth, MockPersonaPicker } from '@/auth/AuthContext';

const TOOLS = [
  { to: '/teams', label: 'Sports setup' },
  { to: '/events', label: 'Dated events' },
  { to: '/contacts', label: 'Contacts & history' },
  { to: '/scoring', label: 'Advisory settings' },
];
export function Layout() {
  const { hasRole } = useAuth();
  return <div className="min-h-screen bg-slate-100">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">LOCAL MOCK REVIEW · Synthetic data · Personas are a demo, not production security · No real messages or ticket delivery</div>
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <NavLink to="/" className="text-xl font-bold tracking-tight text-slate-900">Ticket Concierge<span className="ml-2 text-xs font-normal text-slate-500">Review workspace</span></NavLink>
        <MockPersonaPicker />
      </div>
      <nav aria-label="Main navigation" className="mx-auto flex max-w-7xl flex-wrap gap-1 px-4 pb-3 sm:px-6">
        {[{ to: '/', label: hasRole('admin') ? 'Coordinator workspace' : 'Available tickets' }, ...(hasRole('admin') ? TOOLS : [])].map((item) => <NavLink end key={item.to} to={item.to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>{item.label}</NavLink>)}
      </nav>
    </header>
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><Outlet /></main>
  </div>;
}
