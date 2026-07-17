import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="text-5xl font-bold text-slate-300">404</div>
      <h1 className="mt-3 text-lg font-semibold text-slate-800">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">The page you’re looking for doesn’t exist.</p>
      <Link to="/" className="mt-6">
        <Button variant="secondary">Back to dashboard</Button>
      </Link>
    </div>
  );
}
