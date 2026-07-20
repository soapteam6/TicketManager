import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { RequireAdmin } from './components/RequireAdmin';
import DashboardPage from './pages/DashboardPage';
import TeamsPage from './pages/TeamsPage';
import GamesPage from './pages/GamesPage';
import GameDetailPage from './pages/GameDetailPage';
import EventsPage from './pages/EventsPage';
import RequestsPage from './pages/RequestsPage';
import ContactsPage from './pages/ContactsPage';
import WaitlistPage from './pages/WaitlistPage';
import NotificationsPage from './pages/NotificationsPage';
import ScoringConfigPage from './pages/ScoringConfigPage';
import IntegrationLogsPage from './pages/IntegrationLogsPage';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/games/:gameId" element={<GameDetailPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/waitlist" element={<WaitlistPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route
              path="/scoring"
              element={
                <RequireAdmin>
                  <ScoringConfigPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/integration-logs"
              element={
                <RequireAdmin>
                  <IntegrationLogsPage />
                </RequireAdmin>
              }
            />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
