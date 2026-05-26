// Destination writers — the actual cross-app saves a segment can trigger.
//
// The Daily Capture app doesn't own pastoral_interactions / pastoral_notes /
// resources — those tables belong to the Pastoral Records and Sermons
// apps. But because all the WFUMC apps share one Supabase project, we
// can write to them directly. RLS (owner_user_id = auth.uid()) enforces
// access, and the rows show up natively in the destination app on the
// next page load.
//
// Each helper here writes exactly ONE row and returns a thin envelope
// the caller stamps into the segment's `saved_to` JSONB column:
//   { kind, id, label }

import { supabase, withTimeout } from './supabase';

// ---------------------------------------------------------------------
// Pastoral Records destinations
// ---------------------------------------------------------------------

/**
 * Save a segment as a pastoral_interactions row under the given person.
 * Maps the segment's description → interaction summary, excerpt → body.
 */
export async function saveAsPastoralInteraction({
  ownerUserId,
  personId,
  segment,
  capturedAt,
}) {
  if (!ownerUserId || !personId) {
    throw new Error('saveAsPastoralInteraction requires ownerUserId and personId.');
  }
  if (!segment?.excerpt?.trim()) {
    throw new Error('Cannot save an empty interaction.');
  }
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    // Default to a neutral type; the pastor can re-categorise on the
    // pastoral side if needed.
    interaction_type: 'pastoral_conversation',
    // Use the capture's `captured_at` date if known; otherwise today.
    // pastoral_interactions.happened_at is a timestamptz, but inserting
    // a YYYY-MM-DD value casts cleanly to midnight in the column's TZ.
    happened_at: capturedAt || new Date().toISOString(),
    summary: (segment.description || '').trim() || null,
    body: segment.excerpt.trim(),
  };
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_interactions')
      .insert(payload)
      .select('id')
      .single()
  );
  if (error) throw error;
  return {
    kind: 'pastoral_interaction',
    id: data.id,
    label: `Pastoral interaction (${(segment.description || segment.excerpt || '').slice(0, 60)})`,
  };
}

/**
 * Save a segment as a pastoral_notes row under the given person.
 * Notes are short — we prefer description (Claude's one-liner) as the
 * body, but fall back to excerpt if no description is set.
 */
export async function saveAsPastoralNote({
  ownerUserId,
  personId,
  segment,
  capturedAt,
}) {
  if (!ownerUserId || !personId) {
    throw new Error('saveAsPastoralNote requires ownerUserId and personId.');
  }
  // Prefer the description (Claude's short summary); fall back to
  // excerpt if the pastor cleared it.
  const body =
    (segment?.description || segment?.excerpt || '').trim();
  if (!body) {
    throw new Error('Cannot save an empty note.');
  }
  const payload = {
    owner_user_id: ownerUserId,
    person_id: personId,
    body,
  };
  if (capturedAt) {
    // pastoral_notes.noted_at — captured_at if known, otherwise the DB
    // default-now stamps it.
    payload.noted_at = capturedAt;
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_notes')
      .insert(payload)
      .select('id')
      .single()
  );
  if (error) throw error;
  return {
    kind: 'pastoral_note',
    id: data.id,
    label: `Note (${body.slice(0, 60)})`,
  };
}

// ---------------------------------------------------------------------
// Sermons destinations
// ---------------------------------------------------------------------

/**
 * Save a segment as a resources row in the Sermons app's library.
 *
 * resource_type defaults to 'illustration' — the closest fit out of
 * the Sermons app's allowed values ('story', 'quote', 'illustration',
 * 'joke', 'note', 'photo') for the kind of real-life parallel /
 * anecdote / pastor-observed moment Daily Capture typically surfaces.
 * The pastor can re-categorise to story/quote/joke on the Sermons
 * side if needed.
 *
 * source_label: defaults to "Daily Capture <YYYY-MM-DD>" so when the
 * pastor browses the Resources page, they can see at a glance which
 * resources came from this pipeline.
 */
export async function saveAsSermonResource({
  ownerUserId,
  segment,
  capturedAt,
  captureTitle,
}) {
  if (!ownerUserId) {
    throw new Error('saveAsSermonResource requires ownerUserId.');
  }
  if (!segment?.excerpt?.trim()) {
    throw new Error('Cannot save an empty resource.');
  }
  const dateLabel =
    capturedAt || new Date().toISOString().slice(0, 10);
  const sourceLabel =
    captureTitle
      ? `Daily Capture · ${captureTitle} · ${dateLabel}`
      : `Daily Capture · ${dateLabel}`;
  const payload = {
    owner_user_id: ownerUserId,
    resource_type: 'illustration',
    title: (segment.description || '').trim() || null,
    content: segment.excerpt.trim(),
    source: sourceLabel,
    source_url: null,
    themes: [],
    scripture_refs: null,
    tone: null,
    notes: segment.rationale
      ? `From Daily Capture extraction: ${segment.rationale}`
      : null,
    library_id: null,
    auto_generated: true,
    auto_source_label: sourceLabel,
  };
  const { data, error } = await withTimeout(
    supabase.from('resources').insert(payload).select('id').single()
  );
  if (error) throw error;
  return {
    kind: 'sermon_resource',
    id: data.id,
    label: `Sermon resource (${(segment.description || segment.excerpt).slice(0, 60)})`,
  };
}

// ---------------------------------------------------------------------
// Person directory lookup (for the PersonPicker on review cards)
// ---------------------------------------------------------------------

/**
 * Search the pastoral_people directory by name. Reused by the segment
 * review UI's "match this mention to a person" affordance.
 *
 * Defaults to a soft-cap of 25 rows; the search is case-insensitive
 * against first_name / last_name / preferred_name.
 */
export async function searchPeople({ search = '', limit = 25 } = {}) {
  let q = supabase
    .from('pastoral_people')
    .select(
      'id, first_name, middle_name, last_name, preferred_name, email, is_deceased'
    )
    .order('last_name', { ascending: true })
    .limit(limit);
  const s = (search || '').trim();
  if (s) {
    const escaped = s.replace(/[%_]/g, ' ').slice(0, 60);
    q = q.or(
      `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,preferred_name.ilike.%${escaped}%`
    );
  }
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data || [];
}

export function fullPersonName(p) {
  if (!p) return '';
  const first = p.preferred_name?.trim() || p.first_name?.trim() || '';
  const middle = p.middle_name?.trim() || '';
  const last = p.last_name?.trim() || '';
  return [first, middle, last].filter(Boolean).join(' ');
}

// Create a minimal pastoral_people row from just a name string.
//
// Daily Capture lets the pastor add a new person inline from the
// PersonPicker without bouncing to the Pastoral Records app. We only
// require a name here — every other field (phone, email, address,
// church_member flag, etc.) is left blank and can be filled in later
// on the person's detail page in the Pastoral Records app.
//
// Splitting heuristic: the last whitespace-separated word becomes
// last_name; everything before becomes first_name. Multi-word last
// names ("Van Allen") will get the wrong split — pastor can fix on
// the detail page. This keeps the inline UX to a single field.
export async function createMinimalPerson({ ownerUserId, name }) {
  if (!ownerUserId) throw new Error('Missing user.');
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Name is required.');
  const parts = trimmed.split(/\s+/);
  let first_name;
  let last_name = null;
  if (parts.length === 1) {
    first_name = parts[0];
  } else {
    last_name = parts[parts.length - 1];
    first_name = parts.slice(0, -1).join(' ');
  }
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_people')
      .insert({
        owner_user_id: ownerUserId,
        first_name,
        last_name,
      })
      .select(
        'id, first_name, middle_name, last_name, preferred_name, email, is_deceased'
      )
      .single()
  );
  if (error) throw error;
  return data;
}
