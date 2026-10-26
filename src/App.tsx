import { HashRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { PlatformReview } from './review/PlatformReview';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<PlatformReview />} />
          <Route path="/review" element={<PlatformReview />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
