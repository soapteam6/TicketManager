import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { RequireAdmin } from './components/RequireAdmin';
import DashboardPage from './pages/DashboardPage';
import TeamsPage from './pages/TeamsPage';
import GameDetailPage from './pages/GameDetailPage';
import ContactsPage from './pages/ContactsPage';
import WaitlistPage from './pages/WaitlistPage';
import ScoringConfigPage from './pages/ScoringConfigPage';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/games/:gameId" element={<GameDetailPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/waitlist" element={<WaitlistPage />} />
            <Route
              path="/scoring"
              element={
                <RequireAdmin>
                  <ScoringConfigPage />
                </RequireAdmin>
              }
            />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
