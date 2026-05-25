import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCaptures } from '../lib/captures';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

export default function CaptureList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listCaptures({ limit: 200 });
        if (!cancelled) setItems(rows);
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

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="font-serif text-2xl text-umc-900">All captures</h1>
        <Link to="/captures/new" className="btn-primary text-sm">
          + New capture
        </Link>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingSpinner label="Loading captures…" />
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No captures yet. Use "+ New capture" to start.
        </p>
      ) : (
        <div className="card">
          <ul className="divide-y divide-gray-100">
            {items.map((c) => {
              const created = new Date(c.created_at);
              return (
                <li
                  key={c.id}
                  className="py-2 flex items-baseline gap-2 flex-wrap"
                >
                  <Link
                    to={`/captures/${c.id}`}
                    className="text-sm font-medium text-umc-700 hover:text-umc-900 underline"
                  >
                    {c.title?.trim() ||
                      `Capture from ${created.toLocaleDateString()}`}
                  </Link>
                  <span
                    className={
                      'text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ' +
                      (c.extraction_status === 'reviewed'
                        ? 'text-green-700 bg-green-50 border border-green-200'
                        : c.extraction_status === 'extracted'
                          ? 'text-amber-700 bg-amber-50 border border-amber-200'
                          : 'text-gray-600 bg-gray-50 border border-gray-200')
                    }
                  >
                    {c.extraction_status}
                  </span>
                  {c.captured_at && (
                    <span className="text-[11px] text-gray-500">
                      for {c.captured_at}
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400 ml-auto">
                    {created.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
