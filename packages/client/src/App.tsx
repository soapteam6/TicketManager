import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { ReviewWorkspace } from '@/pages/ReviewWorkspace';
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
import { IntegrationLogsPage } from '@/pages/IntegrationLogsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

function CoordinatorRoutes() { return useAuth().hasRole('admin') ? <Outlet /> : <Navigate to="/" replace />; }
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ReviewWorkspace />} />
        <Route element={<CoordinatorRoutes />}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="seasons/:id" element={<SeasonDetailPage />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="games/:id" element={<GameDetailPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="waitlist" element={<WaitlistPage />} />
        <Route path="notifications" element={<Navigate to="/?view=messages" replace />} />
        <Route path="scoring" element={<ScoringConfigPage />} />
        <Route path="admin/logs" element={<IntegrationLogsPage />} />
        </Route>
        <Route path="404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
