import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { DashboardPage } from '@/pages/DashboardPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { SeasonDetailPage } from '@/pages/SeasonDetailPage';
import { GamesPage } from '@/pages/GamesPage';
import { GameDetailPage } from '@/pages/GameDetailPage';
import { EventsPage } from '@/pages/EventsPage';
import { RequestsPage } from '@/pages/RequestsPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { ScoringConfigPage } from '@/pages/ScoringConfigPage';
import { WaitlistPage } from '@/pages/WaitlistPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { IntegrationLogsPage } from '@/pages/IntegrationLogsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// No authentication: every route is open and lands inside the app shell.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="seasons/:id" element={<SeasonDetailPage />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="games/:id" element={<GameDetailPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="waitlist" element={<WaitlistPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="scoring" element={<ScoringConfigPage />} />
        <Route path="admin/logs" element={<IntegrationLogsPage />} />
        <Route path="404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
