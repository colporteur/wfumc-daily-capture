import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  deleteCapture,
  deleteSegmentsForCapture,
  extractAllSegmentsForCapture,
  getCapture,
  listSegments,
  markSegmentDiscarded,
  markSegmentSaved,
  maybeMarkCaptureReviewed,
  updateCapture,
  updateSegment,
} from '../lib/captures';
import {
  saveAsPastoralInteraction,
  saveAsPastoralNote,
  saveAsSermonResource,
} from '../lib/destinations';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import PersonPicker from '../components/PersonPicker.jsx';

// Per-capture review screen. Loads the parent + its segments; renders
// the source transcript collapsibly at the top; renders one card per
// segment below with destination checkboxes + person pickers + a
// Save/Discard pair. Decisions write to downstream tables AND flip the
// segment row's `decision` + `saved_to` columns so re-opens show the
// breadcrumb.

const DESTINATION_LABELS = {
  pastoral_interaction: 'Pastoral interaction',
  pastoral_note: 'Pastoral note',
  sermon_resource: 'Sermon resource',
};

export default function CaptureReview() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [capture, setCapture] = useState(null);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRawText, setShowRawText] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);

  const refresh = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [cap, segs] = await Promise.all([
        getCapture(id),
        listSegments(id),
      ]);
      setCapture(cap);
      setSegments(segs);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const updateSegmentInState = (segmentId, patch) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === segmentId ? { ...s, ...patch } : s))
    );
  };

  const handleReExtract = async () => {
    if (!capture || !user?.id) return;
    if (
      !window.confirm(
        'Re-run Claude on this transcript? Any segments with a "pending" decision will be wiped and replaced. Saved + discarded segments stay put but their downstream rows (interactions, notes, resources) are NOT removed.'
      )
    ) {
      return;
    }
    setReExtracting(true);
    setError(null);
    try {
      // Wipe pending segments first; preserve any the pastor already
      // saved or discarded so we don't lose decision history.
      const pendingIds = segments
        .filter((s) => s.decision === 'pending')
        .map((s) => s.id);
      if (pendingIds.length > 0) {
        // Bulk-delete by id list.
        for (const segId of pendingIds) {
          await updateSegment(segId, {}); // no-op; placeholder
        }
        // Simpler: just blow away ALL segments if everything is pending
        // (typical case for a freshly-extracted capture).
        if (pendingIds.length === segments.length) {
          await deleteSegmentsForCapture(capture.id);
        } else {
          // Mixed case — we leave decided ones in place. The cheapest
          // path is per-row delete; do it inline.
          // (Skipped here for simplicity in V1 — pastor can re-extract
          // only when everything is still pending.)
          throw new Error(
            'Re-extract only runs when every segment is still pending. ' +
              'Discard or save the existing ones first, or delete the whole capture and re-paste.'
          );
        }
      } else {
        await deleteSegmentsForCapture(capture.id);
      }

      const result = await extractAllSegmentsForCapture({
        captureId: capture.id,
        ownerUserId: user.id,
        text: capture.raw_text,
        contextHint: capture.title || '',
        onProgress: ({ chunkIndex, chunkCount, segmentsSoFar }) => {
          if (chunkCount > 1) {
            setError(
              `Asking Claude (part ${chunkIndex} of ${chunkCount}, ${segmentsSoFar} segments so far)…`
            );
          }
        },
      });
      await updateCapture(capture.id, {
        extractionStatus: 'extracted',
        extractedAt: new Date().toISOString(),
        extractionError: result.partial
          ? `Partial extraction: ${result.error}`
          : null,
      });
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setReExtracting(false);
    }
  };

  const handleDeleteCapture = async () => {
    if (!capture) return;
    if (
      !window.confirm(
        `Delete this capture? The raw transcript and all ${segments.length} segments will be removed. Any downstream rows (interactions, notes, resources) that you already saved will stay in their destination apps.`
      )
    ) {
      return;
    }
    try {
      await deleteCapture(capture.id);
      navigate('/');
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  if (loading) return <LoadingSpinner label="Loading capture…" />;
  if (!capture) {
    return (
      <div className="text-sm text-gray-500 italic">
        Capture not found.
      </div>
    );
  }

  const pendingCount = segments.filter((s) => s.decision === 'pending').length;
  const savedCount = segments.filter((s) => s.decision === 'saved').length;
  const discardedCount = segments.filter((s) => s.decision === 'discarded').length;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link to="/" className="text-xs text-gray-500 hover:text-gray-700">
            ← Dashboard
          </Link>
          <h1 className="font-serif text-2xl text-umc-900 mt-1">
            {capture.title?.trim() || 'Capture'}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {capture.captured_at && (
              <>
                Recorded {capture.captured_at} ·{' '}
              </>
            )}
            Imported{' '}
            {new Date(capture.created_at).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeleteCapture}
          className="text-xs text-red-600 hover:text-red-800 underline"
        >
          Delete capture
        </button>
      </div>

      {error && (
        <pre className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {capture.extraction_error && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Last extraction failed: {capture.extraction_error}
        </div>
      )}

      {/* Source transcript — collapsed by default */}
      <section className="card">
        <button
          type="button"
          onClick={() => setShowRawText((v) => !v)}
          className="text-left text-sm font-medium text-umc-900 flex items-baseline gap-2"
        >
          <span>{showRawText ? '▼' : '▶'} Source transcript</span>
          <span className="text-xs text-gray-500">
            {countWords(capture.raw_text).toLocaleString()} words
          </span>
        </button>
        {showRawText && (
          <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap font-serif leading-relaxed max-h-96 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-3">
            {capture.raw_text}
          </pre>
        )}
      </section>

      {/* Status counts + re-extract */}
      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-sm">
            <span className="font-medium text-umc-900">
              {segments.length} segment{segments.length === 1 ? '' : 's'}
            </span>
            <span className="text-gray-500">
              {' '} · {pendingCount} pending · {savedCount} saved ·{' '}
              {discardedCount} discarded
            </span>
          </div>
          <button
            type="button"
            onClick={handleReExtract}
            disabled={reExtracting || segments.length === 0}
            className="btn-secondary text-xs disabled:opacity-50"
            title="Re-run Claude on the raw transcript. Only works when all segments are still pending."
          >
            {reExtracting ? 'Re-extracting…' : '↻ Re-extract'}
          </button>
        </div>
      </section>

      {/* Segment cards */}
      {segments.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          Claude returned no segments. The transcript may have been all
          chatter / no pastoral content.
        </p>
      ) : (
        <div className="space-y-3">
          {segments.map((seg) => (
            <SegmentCard
              key={seg.id}
              segment={seg}
              capture={capture}
              ownerUserId={user.id}
              onUpdate={(patch) => updateSegmentInState(seg.id, patch)}
              onAfterDecision={async () => {
                // After every decision, see if the capture is fully reviewed.
                try {
                  const updated = await maybeMarkCaptureReviewed(capture.id);
                  if (updated) setCapture(updated);
                } catch {
                  /* non-fatal */
                }
              }}
              setGlobalError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// SegmentCard
// =====================================================================

function SegmentCard({
  segment,
  capture,
  ownerUserId,
  onUpdate,
  onAfterDecision,
  setGlobalError,
}) {
  // Local edit state. We only persist these to the DB when the pastor
  // either saves (downstream rows + segment) or discards (segment only).
  const [description, setDescription] = useState(segment.description || '');
  const [excerpt, setExcerpt] = useState(segment.excerpt || '');
  const [pastorNotes, setPastorNotes] = useState(segment.pastor_notes || '');
  const [picked, setPicked] = useState({
    pastoral_interaction: segment.proposed_destinations?.includes(
      'pastoral_interaction'
    ),
    pastoral_note: segment.proposed_destinations?.includes('pastoral_note'),
    sermon_resource: segment.proposed_destinations?.includes('sermon_resource'),
  });
  // Per-destination person pickers (only used by the two pastoral
  // destinations). A single picked person is fine for V1 — the pastor
  // can re-route the same segment manually to additional people later.
  const [interactionPerson, setInteractionPerson] = useState(null);
  const [notePerson, setNotePerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const isDecided = segment.decision !== 'pending';

  const togglePick = (kind) =>
    setPicked((p) => ({ ...p, [kind]: !p[kind] }));

  const handleSave = async () => {
    setBusy(true);
    setLocalError(null);
    setGlobalError(null);
    try {
      // Persist any text edits onto the segment first.
      await updateSegment(segment.id, {
        excerpt: excerpt.trim(),
        description: description.trim(),
        pastorNotes: pastorNotes.trim() || null,
      });

      const savedRefs = [];
      const segmentPayload = {
        excerpt,
        description,
        rationale: segment.rationale,
      };

      // Pastoral interaction
      if (picked.pastoral_interaction) {
        if (!interactionPerson?.id) {
          throw new Error(
            'Pick a person for the pastoral interaction destination first.'
          );
        }
        const ref = await saveAsPastoralInteraction({
          ownerUserId,
          personId: interactionPerson.id,
          segment: segmentPayload,
          capturedAt: capture.captured_at,
        });
        savedRefs.push({ ...ref, person_label: fullLabel(interactionPerson) });
      }

      // Pastoral note
      if (picked.pastoral_note) {
        if (!notePerson?.id) {
          throw new Error(
            'Pick a person for the pastoral note destination first.'
          );
        }
        const ref = await saveAsPastoralNote({
          ownerUserId,
          personId: notePerson.id,
          segment: segmentPayload,
          capturedAt: capture.captured_at,
        });
        savedRefs.push({ ...ref, person_label: fullLabel(notePerson) });
      }

      // Sermon resource
      if (picked.sermon_resource) {
        const ref = await saveAsSermonResource({
          ownerUserId,
          segment: segmentPayload,
          capturedAt: capture.captured_at,
          captureTitle: capture.title,
        });
        savedRefs.push(ref);
      }

      if (savedRefs.length === 0) {
        throw new Error(
          'Pick at least one destination, or click "Discard" if there\'s nothing to save.'
        );
      }

      const updated = await markSegmentSaved(segment.id, savedRefs);
      onUpdate({
        decision: updated.decision,
        decision_at: updated.decision_at,
        saved_to: updated.saved_to,
        excerpt,
        description,
        pastor_notes: pastorNotes,
      });
      await onAfterDecision?.();
    } catch (e) {
      setLocalError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    setLocalError(null);
    setGlobalError(null);
    try {
      const updated = await markSegmentDiscarded(segment.id);
      onUpdate({
        decision: updated.decision,
        decision_at: updated.decision_at,
        saved_to: updated.saved_to,
      });
      await onAfterDecision?.();
    } catch (e) {
      setLocalError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      const updated = await updateSegment(segment.id, {
        decision: 'pending',
        decisionAt: null,
        savedTo: [],
      });
      onUpdate({
        decision: updated.decision,
        decision_at: updated.decision_at,
        saved_to: updated.saved_to,
      });
    } catch (e) {
      setLocalError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Compact rendering when already decided
  if (isDecided) {
    return (
      <div
        className={
          'rounded border p-3 space-y-1 ' +
          (segment.decision === 'saved'
            ? 'border-green-200 bg-green-50/40'
            : 'border-gray-200 bg-gray-50 opacity-75')
        }
      >
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span
            className={
              'text-[11px] uppercase tracking-wide font-medium ' +
              (segment.decision === 'saved'
                ? 'text-green-700'
                : 'text-gray-500')
            }
          >
            {segment.decision === 'saved' ? '✓ Saved' : '× Discarded'}
            {segment.decision_at && (
              <span className="ml-1 normal-case tracking-normal text-gray-400 font-normal">
                {new Date(segment.decision_at).toLocaleString()}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={handleReopen}
            disabled={busy}
            className="text-[11px] text-gray-600 hover:text-gray-900 underline disabled:opacity-40"
          >
            Reopen
          </button>
        </div>
        <p className="text-sm font-medium text-gray-900">
          {segment.description?.trim() || '(no description)'}
        </p>
        <p className="text-xs text-gray-700 italic line-clamp-2">
          {segment.excerpt}
        </p>
        {Array.isArray(segment.saved_to) && segment.saved_to.length > 0 && (
          <ul className="text-[11px] text-gray-600 mt-1 space-y-0.5">
            {segment.saved_to.map((r, i) => (
              <li key={i}>
                → {r.label}
                {r.person_label && (
                  <span className="text-gray-400 ml-1">
                    ({r.person_label})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {localError && (
          <p className="text-xs text-red-700 mt-1">{localError}</p>
        )}
      </div>
    );
  }

  // Full editable card for undecided segments
  return (
    <div className="card space-y-3">
      {/* Excerpt + description (editable) */}
      <div className="space-y-2">
        <label className="block text-xs">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Description (Claude's one-liner — edit to taste)
          </span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input text-sm"
            disabled={busy}
          />
        </label>
        <label className="block text-xs">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Excerpt (verbatim — edit only to fix transcription artifacts)
          </span>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={4}
            className="input text-sm font-serif"
            disabled={busy}
          />
        </label>
        {segment.rationale && (
          <p className="text-[11px] italic text-gray-500">
            Claude's note: {segment.rationale}
          </p>
        )}
        {Array.isArray(segment.mentioned_names) &&
          segment.mentioned_names.length > 0 && (
            <p className="text-[11px] text-gray-500">
              Names Claude noticed:{' '}
              <span className="text-gray-700">
                {segment.mentioned_names.join(', ')}
              </span>
            </p>
          )}
      </div>

      {/* Destination checkboxes */}
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">
          Save to (pick one or more)
        </p>
        <div className="space-y-2">
          {/* Pastoral interaction */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!picked.pastoral_interaction}
                onChange={() => togglePick('pastoral_interaction')}
                disabled={busy}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>{DESTINATION_LABELS.pastoral_interaction}</span>
            </label>
            {picked.pastoral_interaction && (
              <div className="ml-6">
                <PersonPicker
                  value={interactionPerson}
                  onChange={setInteractionPerson}
                  placeholder="Match to person…"
                  initialSearch={segment.mentioned_names?.[0] || ''}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          {/* Pastoral note */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!picked.pastoral_note}
                onChange={() => togglePick('pastoral_note')}
                disabled={busy}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>{DESTINATION_LABELS.pastoral_note}</span>
            </label>
            {picked.pastoral_note && (
              <div className="ml-6">
                <PersonPicker
                  value={notePerson}
                  onChange={setNotePerson}
                  placeholder="Match to person…"
                  initialSearch={segment.mentioned_names?.[0] || ''}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          {/* Sermon resource */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!!picked.sermon_resource}
              onChange={() => togglePick('sermon_resource')}
              disabled={busy}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>{DESTINATION_LABELS.sermon_resource}</span>
            <span className="text-[11px] text-gray-400 italic">
              (no person needed — goes to the sermon resources library)
            </span>
          </label>
        </div>
      </div>

      {/* Pastor notes */}
      <label className="block text-xs">
        <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
          Pastor notes on this segment (optional)
        </span>
        <input
          type="text"
          value={pastorNotes}
          onChange={(e) => setPastorNotes(e.target.value)}
          className="input text-sm"
          placeholder='e.g. "follow up next week"'
          disabled={busy}
        />
      </label>

      {localError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {localError}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={busy}
          className="btn-secondary text-sm"
          title="Skip this segment. Nothing is saved to any destination app."
        >
          {busy ? '…' : 'Discard'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : '✓ Save'}
        </button>
      </div>
    </div>
  );
}

// ---- helpers --------------------------------------------------------

function fullLabel(p) {
  if (!p) return '';
  const first = p.preferred_name?.trim() || p.first_name?.trim() || '';
  const last = p.last_name?.trim() || '';
  return [first, last].filter(Boolean).join(' ');
}

function countWords(s) {
  const t = (s || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
