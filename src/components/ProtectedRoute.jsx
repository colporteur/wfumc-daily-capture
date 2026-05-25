import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';

// Pastor-only gate for the entire Daily Capture app. If the user isn't
// signed in → bounce to /login. If signed in but not pastor → show a
// polite "not authorized" message rather than redirect, so they know
// what's happening (and can use the Sign out link if needed).
//
// RLS on daily_captures + daily_capture_segments is the actual security
// boundary; this is the UX layer on top of it.
export default function ProtectedRoute({ children }) {
  const { user, loading, isPastor } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner label="Checking access…" />;
  }

  if (!user) {
    // Preserve the path we were trying to reach so we can return after sign-in.
    const target = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${target}`} replace />;
  }

  if (!isPastor) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center space-y-3">
          <h1 className="font-serif text-xl text-umc-900">Not authorized</h1>
          <p className="text-sm text-gray-600">
            The Daily Capture app is restricted to the pastor account.
            Your sign-in is valid, but this app isn't visible to your role.
          </p>
          <p className="text-xs text-gray-500">
            If you believe this is an error, contact the pastor to update
            your staff role.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
