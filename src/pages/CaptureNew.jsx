import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createCapture,
  extractAllSegmentsForCapture,
  updateCapture,
} from '../lib/captures';

// New capture page: pastor pastes/uploads a transcript, optionally
// fills in metadata, and we kick off the Claude extraction pass right
// away. On success, we redirect to the review screen for that capture.
//
// .docx uploads are decoded client-side via mammoth (dynamic import
// to keep the initial bundle small).

export default function CaptureNew() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [title, setTitle] = useState('');
  const [capturedAt, setCapturedAt] = useState(todayIso());
  const [contextHint, setContextHint] = useState('');
  const [text, setText] = useState('');
  const [sourceFilename, setSourceFilename] = useState('');
  const [sourceKind, setSourceKind] = useState('paste'); // flips to 'upload' on file pick

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');

  const handleFile = async (files) => {
    if (!files || !files[0]) return;
    const file = files[0];
    setError(null);
    setBusy(true);
    try {
      setProgressMsg('Reading file…');
      const extracted = await extractTextFromFile(file);
      setText(extracted);
      setSourceFilename(file.name);
      setSourceKind('upload');
      // Use the filename (minus extension) as a default title if blank.
      if (!title.trim()) {
        setTitle(file.name.replace(/\.[^.]+$/, ''));
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
      setProgressMsg('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!user?.id) return;
    if (!text.trim()) {
      setError('Paste or upload a transcript first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setProgressMsg('Saving capture…');
      const capture = await createCapture({
        ownerUserId: user.id,
        sourceKind,
        sourceFilename: sourceKind === 'upload' ? sourceFilename : null,
        title,
        capturedAt: capturedAt || null,
        notes: null,
        rawText: text,
      });

      setProgressMsg('Asking Claude to segment + classify…');
      let result;
      try {
        result = await extractAllSegmentsForCapture({
          captureId: capture.id,
          ownerUserId: user.id,
          text,
          contextHint: contextHint || title,
          onProgress: ({ chunkIndex, chunkCount, segmentsSoFar }) => {
            // Long-transcript path: tell the pastor how far along we are
            // so they don't think the spinner has hung.
            if (chunkCount > 1) {
              setProgressMsg(
                `Asking Claude to segment + classify (part ${chunkIndex} of ${chunkCount}` +
                  (segmentsSoFar > 0
                    ? `, ${segmentsSoFar} segments so far`
                    : '') +
                  `)…`
              );
            }
          },
        });
      } catch (e) {
        // Persist the error on the capture row so the dashboard can
        // surface "this one needs a retry" instead of just spinning.
        await updateCapture(capture.id, {
          extractionError: e.message || String(e),
        });
        throw e;
      }

      // Even a partial extraction (some chunks failed, some landed) is
      // worth surfacing — the pastor can review what came through and
      // re-extract if they want more.
      await updateCapture(capture.id, {
        extractionStatus: 'extracted',
        extractedAt: new Date().toISOString(),
        extractionError: result.partial
          ? `Partial extraction: ${result.error}`
          : null,
      });

      navigate(`/captures/${capture.id}`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
      setProgressMsg('');
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="font-serif text-2xl text-umc-900">New capture</h1>
      <p className="text-sm text-gray-600">
        Paste a transcript (typically from Plaud Note) or upload a .txt /
        .docx file. Claude will split it into pastorally-meaningful
        segments and propose where each one should land.
      </p>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 whitespace-pre-wrap">
          {error}
        </p>
      )}

      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="label">Title (optional)</span>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Tuesday morning hospital rounds"'
              disabled={busy}
            />
          </label>
          <label className="block text-sm">
            <span className="label">When was this recorded?</span>
            <input
              type="date"
              className="input"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="label">
            Context hint (optional)
            <span className="ml-1 font-normal text-gray-500">
              — short note about what's in this recording
            </span>
          </span>
          <input
            type="text"
            className="input"
            value={contextHint}
            onChange={(e) => setContextHint(e.target.value)}
            placeholder={`e.g. "visits at the nursing home; ladies' Bible study afterward"`}
            disabled={busy}
          />
        </label>

        <div>
          <span className="label">Transcript</span>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="btn-secondary text-xs"
            >
              📄 Upload .txt or .docx
            </button>
            {sourceFilename && (
              <span className="text-xs text-gray-500 italic">
                Loaded: {sourceFilename}
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
          </div>
          <textarea
            rows={14}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // Switching back to typed text after a file upload —
              // re-flag the source kind so we don't mislead the DB.
              if (sourceKind === 'upload' && sourceFilename) {
                // Leave sourceKind as 'upload' if filename still in
                // place; pastor can clear it manually if they want.
              } else {
                setSourceKind('paste');
              }
            }}
            placeholder="Paste the transcript here…"
            className="input font-serif text-sm leading-relaxed"
            disabled={busy}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            {countWords(text).toLocaleString()} words
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !text.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy
              ? progressMsg || 'Working…'
              : '✨ Save & extract with Claude'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- helpers --------------------------------------------------------

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function countWords(s) {
  const t = (s || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

async function extractTextFromFile(file) {
  if (!file) throw new Error('No file');
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return file.text();
  }
  if (name.endsWith('.docx')) {
    // Dynamic import keeps mammoth out of the initial bundle.
    const mammoth = (await import('mammoth')).default;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result?.value || '').trim();
  }
  // Last-resort: try reading as text.
  try {
    return await file.text();
  } catch {
    throw new Error(
      `Unsupported file type: ${file.type || name}. Supported: .txt, .docx, or pasted plain text.`
    );
  }
}
