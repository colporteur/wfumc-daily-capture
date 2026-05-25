import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listCaptures,
  listNeedsActionCaptures,
} from '../lib/captures';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

// Dashboard surface: "what's waiting on you" + "what you've done lately".
// Captures that are still 'pending' or 'extracted' (i.e. Claude hasn't
// run yet OR segments still need review) show in the top panel; the
// recent list below is a 10-deep slice of everything regardless of
// state.

export default function Dashboard() {
  const [needsAction, setNeedsAction] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [todo, all] = await Promise.all([
          listNeedsActionCaptures({ limit: 20 }),
          listCaptures({ limit: 10 }),
        ]);
        if (!cancelled) {
          setNeedsAction(todo);
          setRecent(all);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingSpinner label="Loading dashboard…" />;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="font-serif text-2xl text-umc-900">Daily Capture</h1>
        <Link to="/captures/new" className="btn-primary text-sm">
          + New capture
        </Link>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg text-umc-900">
            Waiting on you
          </h2>
          <span className="text-xs text-gray-500">
            {needsAction.length}{' '}
            {needsAction.length === 1 ? 'capture' : 'captures'}
          </span>
        </div>
        {needsAction.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            All caught up. Paste a new transcript when you're ready.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {needsAction.map((c) => (
              <CaptureRow key={c.id} capture={c} />
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg text-umc-900">Recent</h2>
          <Link
            to="/captures"
            className="text-xs text-umc-700 hover:text-umc-900 underline"
          >
            See all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No captures yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((c) => (
              <CaptureRow key={c.id} capture={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CaptureRow({ capture }) {
  const created = new Date(capture.created_at);
  return (
    <li className="py-2 flex items-baseline gap-2 flex-wrap">
      <Link
        to={`/captures/${capture.id}`}
        className="text-sm font-medium text-umc-700 hover:text-umc-900 underline truncate"
      >
        {capture.title?.trim() ||
          `Capture from ${created.toLocaleDateString()}`}
      </Link>
      <span className="text-[10px] uppercase tracking-wide text-gray-500">
        {capture.extraction_status}
      </span>
      {capture.captured_at && (
        <span className="text-[11px] text-gray-500">
          for {capture.captured_at}
        </span>
      )}
      <span className="text-[11px] text-gray-400 ml-auto">
        {created.toLocaleString()}
      </span>
    </li>
  );
}
