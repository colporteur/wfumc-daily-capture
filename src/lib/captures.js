// CRUD over daily_captures + daily_capture_segments. Both tables are
// owner-scoped via RLS; on insert we still stamp owner_user_id so the
// row shows up to the creator immediately.

import { supabase, withTimeout } from './supabase';

// ---------------------------------------------------------------------
// daily_captures
// ---------------------------------------------------------------------

export async function createCapture({
  ownerUserId,
  sourceKind,
  sourceFilename = null,
  title = null,
  capturedAt = null,
  notes = null,
  rawText,
}) {
  if (!ownerUserId) throw new Error('Missing user.');
  if (!rawText || !rawText.trim()) {
    throw new Error('Cannot create a capture with empty text.');
  }
  if (!['paste', 'upload'].includes(sourceKind)) {
    throw new Error(`Invalid sourceKind: ${sourceKind}`);
  }
  const { data, error } = await withTimeout(
    supabase
      .from('daily_captures')
      .insert({
        owner_user_id: ownerUserId,
        source_kind: sourceKind,
        source_filename: sourceFilename,
        title: title?.trim() || null,
        captured_at: capturedAt || null,
        notes: notes?.trim() || null,
        raw_text: rawText,
      })
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function getCapture(captureId) {
  if (!captureId) throw new Error('captureId required');
  const { data, error } = await withTimeout(
    supabase
      .from('daily_captures')
      .select('*')
      .eq('id', captureId)
      .single()
  );
  if (error) throw error;
  return data;
}

export async function listCaptures({ limit = 50 } = {}) {
  const { data, error } = await withTimeout(
    supabase
      .from('daily_captures')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return data || [];
}

// "Things waiting on you" — captures whose extraction hasn't run yet
// OR whose segments still have undecided rows. Used by the Dashboard.
export async function listNeedsActionCaptures({ limit = 20 } = {}) {
  const { data, error } = await withTimeout(
    supabase
      .from('daily_captures')
      .select('*')
      .in('extraction_status', ['pending', 'extracted'])
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return data || [];
}

export async function updateCapture(captureId, patch = {}) {
  if (!captureId) throw new Error('captureId required');
  const colMap = {
    title: 'title',
    capturedAt: 'captured_at',
    notes: 'notes',
    extractionStatus: 'extraction_status',
    extractedAt: 'extracted_at',
    extractionError: 'extraction_error',
    rawText: 'raw_text',
  };
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = colMap[k] || k;
    out[col] = v;
  }
  const { data, error } = await withTimeout(
    supabase
      .from('daily_captures')
      .update(out)
      .eq('id', captureId)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteCapture(captureId) {
  if (!captureId) throw new Error('captureId required');
  // Segments cascade via the FK; no need to wipe them manually.
  const { error } = await withTimeout(
    supabase.from('daily_captures').delete().eq('id', captureId)
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------
// daily_capture_segments
// ---------------------------------------------------------------------

export async function listSegments(captureId) {
  if (!captureId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('daily_capture_segments')
      .select('*')
      .eq('capture_id', captureId)
      .order('sort_order', { ascending: true })
  );
  if (error) throw error;
  return data || [];
}

// Bulk-insert segments after a Claude extraction. Used by CaptureNew /
// CaptureReview's re-extract handlers. The caller is responsible for
// wiping prior segments first if this is a re-extraction.
export async function bulkInsertSegments({
  captureId,
  ownerUserId,
  segments,
}) {
  if (!captureId || !ownerUserId) {
    throw new Error('bulkInsertSegments requires captureId and ownerUserId.');
  }
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const rows = segments.map((s, i) => ({
    capture_id: captureId,
    owner_user_id: ownerUserId,
    excerpt: (s.excerpt || '').trim(),
    description: (s.description || '').trim() || null,
    proposed_destinations: Array.isArray(s.proposed_destinations)
      ? s.proposed_destinations
      : [],
    mentioned_names: Array.isArray(s.mentioned_names)
      ? s.mentioned_names
      : [],
    rationale: (s.rationale || '').trim() || null,
    sort_order: i,
  }));
  const { data, error } = await withTimeout(
    supabase.from('daily_capture_segments').insert(rows).select('*')
  );
  if (error) throw error;
  return data || [];
}

export async function deleteSegmentsForCapture(captureId) {
  if (!captureId) return;
  const { error } = await withTimeout(
    supabase
      .from('daily_capture_segments')
      .delete()
      .eq('capture_id', captureId)
  );
  if (error) throw error;
}

export async function updateSegment(segmentId, patch = {}) {
  if (!segmentId) throw new Error('segmentId required');
  const colMap = {
    excerpt: 'excerpt',
    description: 'description',
    proposedDestinations: 'proposed_destinations',
    mentionedNames: 'mentioned_names',
    rationale: 'rationale',
    decision: 'decision',
    decisionAt: 'decision_at',
    savedTo: 'saved_to',
    pastorNotes: 'pastor_notes',
    sortOrder: 'sort_order',
  };
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = colMap[k] || k;
    out[col] = v;
  }
  const { data, error } = await withTimeout(
    supabase
      .from('daily_capture_segments')
      .update(out)
      .eq('id', segmentId)
      .select('*')
      .single()
  );
  if (error) throw error;
  return data;
}

// Mark a segment with a decision + (optionally) what downstream rows
// it produced. Wrapper around updateSegment for readability.
export async function markSegmentSaved(segmentId, savedRefs) {
  return updateSegment(segmentId, {
    decision: 'saved',
    decisionAt: new Date().toISOString(),
    savedTo: Array.isArray(savedRefs) ? savedRefs : [],
  });
}
export async function markSegmentDiscarded(segmentId) {
  return updateSegment(segmentId, {
    decision: 'discarded',
    decisionAt: new Date().toISOString(),
    savedTo: [],
  });
}

// Once every segment has a decision, flip the parent capture to
// 'reviewed'. Caller invokes after each segment decision; this checks
// the remaining pending count and only flips if zero.
export async function maybeMarkCaptureReviewed(captureId) {
  if (!captureId) return null;
  const { count, error } = await withTimeout(
    supabase
      .from('daily_capture_segments')
      .select('id', { count: 'exact', head: true })
      .eq('capture_id', captureId)
      .eq('decision', 'pending')
  );
  if (error) throw error;
  if ((count || 0) > 0) return null;
  return updateCapture(captureId, {
    extractionStatus: 'reviewed',
  });
}
