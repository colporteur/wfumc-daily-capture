import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createMinimalPerson,
  fullPersonName,
  searchPeople,
} from '../lib/destinations';

// Typeahead picker for a pastoral_people row. Mirrors the Pastoral
// Records app's PersonPicker but trimmed: no exclude list, no preset
// pre-selection — just "search, pick, here's the chosen person".
//
// Used by the segment review card to bind each segment to a directory
// person before saving as a pastoral interaction / note.

export default function PersonPicker({
  value,
  onChange,
  placeholder = 'Search directory…',
  initialSearch = '',
  disabled = false,
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState(initialSearch);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  // Inline "Create new" form state. When `creatingMode` is true, the
  // dropdown panel swaps the search results for a one-field create
  // form. On submit, we insert a minimal pastoral_people row and
  // treat it as the picked person — no detail-page round-trip.
  const [creatingMode, setCreatingMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await searchPeople({ search });
        if (cancelled) return;
        setResults(rows.slice(0, 25));
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handlePick = (p) => {
    onChange?.(p);
    setSearch('');
    setOpen(false);
    setCreatingMode(false);
    setNewName('');
  };

  const handleCreate = async () => {
    if (!user?.id) {
      setError('Not signed in.');
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed) {
      setError('Enter a name first.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createMinimalPerson({
        ownerUserId: user.id,
        name: trimmed,
      });
      handlePick(created);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCreating(false);
    }
  };

  const enterCreateMode = () => {
    // Pre-fill the create form with whatever the pastor was typing —
    // saves them re-typing if they searched, found nothing, and decided
    // to add this exact name.
    setNewName(search.trim());
    setCreatingMode(true);
  };

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1.5 truncate">
            {fullPersonName(value)}
            {value.is_deceased && (
              <span className="ml-1 text-[10px] text-gray-400 italic">
                (deceased)
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onChange?.(null)}
            disabled={disabled}
            className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-40"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
            placeholder={placeholder}
            className="input"
          />
          {open && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
              {creatingMode ? (
                <div className="p-2 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 px-1">
                    Create new directory entry
                  </p>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreate();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setCreatingMode(false);
                      }
                    }}
                    placeholder="Full name (e.g. Mary Ann Lanier)"
                    className="input text-sm"
                    autoFocus
                    disabled={creating}
                  />
                  <p className="text-[10px] text-gray-500 px-1">
                    Just the name is saved now. Fill in phone, address,
                    family, etc. on their PersonDetail page later.
                  </p>
                  {error && (
                    <p className="text-xs text-red-600 px-1">{error}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingMode(false);
                        setError(null);
                      }}
                      disabled={creating}
                      className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={creating || !newName.trim()}
                      className="btn-primary text-xs disabled:opacity-50"
                    >
                      {creating ? 'Creating…' : 'Create + pick'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {loading && (
                    <p className="text-xs text-gray-500 italic px-3 py-2">
                      Searching…
                    </p>
                  )}
                  {error && (
                    <p className="text-xs text-red-600 px-3 py-2">{error}</p>
                  )}
                  {!loading && !error && results.length === 0 && (
                    <p className="text-xs text-gray-500 italic px-3 py-2">
                      {search.trim()
                        ? 'No matches.'
                        : 'Type to search the directory.'}
                    </p>
                  )}
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handlePick(r)}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-umc-50"
                    >
                      <span className="font-medium">{fullPersonName(r)}</span>
                      {r.email && (
                        <span className="ml-2 text-xs text-gray-500">
                          {r.email}
                        </span>
                      )}
                      {r.is_deceased && (
                        <span className="ml-2 text-xs italic text-gray-400">
                          (deceased)
                        </span>
                      )}
                    </button>
                  ))}
                  {/* "+ Create new" lives at the bottom of every results
                      panel — even when there ARE matches, in case the
                      pastor knows the existing matches aren't the same
                      person they have in mind. */}
                  <button
                    type="button"
                    onClick={enterCreateMode}
                    className="block w-full text-left px-3 py-1.5 text-sm text-umc-700 hover:bg-umc-50 border-t border-gray-100"
                  >
                    + Create new{search.trim() ? `: "${search.trim()}"` : ' directory entry'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
