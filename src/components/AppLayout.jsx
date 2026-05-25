import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import VersionStamp from './VersionStamp.jsx';

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const navClass = ({ isActive }) =>
    isActive
      ? 'block px-3 py-2 rounded-md text-sm font-medium bg-umc-50 text-umc-900'
      : 'block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-umc-900 text-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <Link to="/" className="font-serif text-lg">
            WFUMC Daily Capture
          </Link>
          <div className="flex items-center gap-3 sm:gap-4 text-sm">
            <span className="text-umc-100 hidden sm:inline">
              {profile?.full_name}{' '}
              <span className="text-umc-200">({profile?.role})</span>
            </span>
            <button
              onClick={handleSignOut}
              className="text-umc-100 hover:text-white underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row">
        <aside className="md:w-56 p-4 md:p-6">
          <nav className="space-y-1">
            <NavLink to="/" end className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/captures" className={navClass}>
              All captures
            </NavLink>
            <NavLink to="/captures/new" className={navClass}>
              + New capture
            </NavLink>
          </nav>
        </aside>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
          <VersionStamp />
        </main>
      </div>
    </div>
  );
}
