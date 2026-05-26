import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  bulkInsertSegments,
  createCapture,
  updateCapture,
} from '../lib/captures';
import { segmentAndClassifyTranscript } from '../lib/claude';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

// Landing page for the Web Share Target intent.
//
// Two arrival paths (we handle both transparently):
//   1. POST → SW intercept → cache stash → 303 redirect here with
//      ?from=sw. We hit /__share_consume__ to read + clear the
//      stashed payload (text, optional filename/title/url).
//   2. GET share with text/title/url URL params (the simpler
//      Share-Target flavor used by apps that share plain text rather
//      than a file). We read params directly.
//
// Either way, we end up with a payload. The auto-flow then:
//   - creates a daily_captures row
//   - runs Claude segmentAndClassifyTranscript
//   - persists segments
//   - flips extraction_status to 'extracted'
//   - navigates to /captures/:id so the pastor lands on the review
//     screen with all the cards ready
//
// Edge cases:
//   - User opened /share directly (no shared content) → friendly
//     "no shared content found" panel pointing them at /captures/new
//   - Claude extraction fails → capture is created and reachable from
//     the dashboard with extraction_error set, but we still navigate
//     so the pastor sees the failure surface and can retry there

export default function ShareTarget() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [error, setError] = useState(null);
  const [progressMsg, setProgressMsg] = useState(
    'Loading shared transcript…'
  );
  // useRef + initial flag so React 18 strict-mode double-invoke
  // doesn't try to create two captures from a single share.
  const startedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return; // ProtectedRoute will bounce to /login?next=...
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        // 1) Try the SW-stashed payload (file POST path).
        let payload = await consumeSharedPayload();

        // 2) Fall back to URL params (text GET path).
        if (!payload || !(payload.text && payload.text.trim())) {
          const text = searchParams.get('text') || '';
          const title = searchParams.get('title') || '';
          const sharedUrl = searchParams.get('url') || '';
          if (text.trim()) {
            payload = { text, title, url: sharedUrl, filename: null };
          }
        }

        if (!payload || !(payload.text && payload.text.trim())) {
          throw new Error(
            'No shared content found. To share a transcript, use the ' +
              'sending app\'s Share button and pick "WFUMC Daily ' +
              'Capture" from the share sheet.'
          );
        }

        if (cancelled) return;
        setProgressMsg('Creating capture…');
        const defaultTitle = payload.title?.trim()
          ? payload.title.trim()
          : payload.filename
            ? payload.filename.replace(/\.[^.]+$/, '')
            : `Shared transcript — ${new Date().toLocaleString()}`;

        const notesParts = [];
        if (payload.url) notesParts.push(`Shared URL: ${payload.url}`);
        if (payload.filename)
          notesParts.push(`Original filename: ${payload.filename}`);

        const capture = await createCapture({
          ownerUserId: user.id,
          sourceKind: 'upload',
          sourceFilename: payload.filename || null,
          title: defaultTitle,
          capturedAt: todayIso(),
          notes: notesParts.join('\n') || null,
          rawText: payload.text,
        });

        if (cancelled) return;
        setProgressMsg('Asking Claude to segment + classify…');
        let extraction;
        try {
          extraction = await segmentAndClassifyTranscript({
            text: payload.text,
            contextHint: defaultTitle,
          });
        } catch (e) {
          // Save the error on the capture row so the dashboard / review
          // screen can surface "needs a retry" rather than just spin.
          await updateCapture(capture.id, {
            extractionError: e.message || String(e),
          });
          // Navigate anyway so the pastor sees the broken capture and
          // can decide what to do (delete, manually paste, etc.).
          if (!cancelled) navigate(`/captures/${capture.id}`, { replace: true });
          return;
        }

        if (cancelled) return;
        setProgressMsg('Saving segments…');
        await bulkInsertSegments({
          captureId: capture.id,
          ownerUserId: user.id,
          segments: extraction.segments,
        });
        await updateCapture(capture.id, {
          extractionStatus: 'extracted',
          extractedAt: new Date().toISOString(),
          extractionError: null,
        });

        if (!cancelled) {
          navigate(`/captures/${capture.id}`, { replace: true });
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
    // searchParams identity stays stable for a given URL; user.id only
    // flips on sign-in / sign-out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  if (error) {
    return (
      <div className="card max-w-md mx-auto space-y-3 mt-12">
        <h1 className="font-serif text-xl text-umc-900">
          Couldn't process the share
        </h1>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{error}</p>
        <div className="flex gap-2 flex-wrap pt-2">
          <Link to="/" className="btn-secondary text-sm">
            Dashboard
          </Link>
          <Link to="/captures/new" className="btn-primary text-sm">
            Paste manually instead
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="card text-center">
        <h1 className="font-serif text-xl text-umc-900 mb-3">
          Processing shared transcript…
        </h1>
        <LoadingSpinner label={progressMsg} />
        <p className="text-xs text-gray-500 mt-3">
          You'll land on the review screen as soon as Claude finishes
          segmenting. This usually takes 5–30 seconds depending on the
          length of the recording.
        </p>
      </div>
    </div>
  );
}

// ----- helpers ------------------------------------------------------

// Hit the SW's /__share_consume__ endpoint to read + atomically clear
// the share-target payload it stashed during the POST intercept.
// Returns the parsed JSON object (which may be empty if there's
// nothing stashed) or null on hard failure.
async function consumeSharedPayload() {
  if (typeof fetch !== 'function') return null;
  try {
    // Relative URL so it resolves under whatever base path the PWA is
    // served from (works both at /__share_consume__ in dev and
    // /wfumc-daily-capture/__share_consume__ on Pages).
    const res = await fetch('__share_consume__', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object') return null;
    return body;
  } catch {
    return null;
  }
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
