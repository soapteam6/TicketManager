import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import logoUrl from '../assets/ais-logo.webp';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from './Spinner';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const NAV: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: <Icon path="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10" /> }],
  },
  {
    heading: 'Inventory',
    items: [
      {
        to: '/teams',
        label: 'Teams & Seasons',
        icon: <Icon path="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm7 0a3 3 0 10-3-3" />,
      },
    ],
  },
  {
    heading: 'Distribution',
    items: [
      {
        to: '/contacts',
        label: 'Contacts',
        icon: <Icon path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
      },
      { to: '/waitlist', label: 'Waitlist', icon: <Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /> },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      {
        to: '/scoring',
        label: 'Scoring Engine',
        adminOnly: true,
        icon: (
          <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        ),
      },
    ],
  },
];

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading } = useAuth();

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
        <span className="flex items-center rounded-md bg-white px-2 py-1.5 shadow-sm">
          <img src={logoUrl} alt="AIS" className="h-6 w-auto" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">Ticket Concierge</div>
          <div className="text-[11px] text-slate-400">Season Ticket Manager</div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV.map((section) => {
          const items = section.items.filter((item) => !item.adminOnly || user?.isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={section.heading}>
              <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{section.heading}</div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                        isActive ? 'bg-brand-600/15 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <aside className="hidden w-64 shrink-0 bg-slate-900 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="ml-auto flex items-center gap-2">
            {loading ? (
              <Spinner size="sm" />
            ) : user ? (
              <span className="text-sm text-slate-600">{user.fullName}</span>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
