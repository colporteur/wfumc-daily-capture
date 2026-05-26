// Claude integration for the Daily Capture app.
//
// Routes through the shared `claude-proxy` Edge Function that the
// other WFUMC apps use — they all share one Supabase project, so the
// proxy is already deployed. The proxy is auth-gated (any signed-in
// staff member can call it) and pulls the Anthropic key from
// public.church_settings server-side, so the API key never reaches
// the browser.
//
// Single helper for now:
//
//   segmentAndClassifyTranscript({text, contextHint?})
//     Asks Claude to split the transcript into pastorally-meaningful
//     segments and classify each one against the canonical destination
//     set (pastoral_interaction / pastoral_note / sermon_resource).
//     Returns { segments: [...] } where each segment carries its
//     own destination proposal, mentioned names, and rationale.

import { supabase, withTimeout } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

/**
 * Low-level proxy call. Mirrors the other WFUMC apps' callClaude.
 * @param {Object} body { messages, system?, max_tokens?, model? }
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=120000] Daily transcripts can be long.
 */
export async function callClaude(body, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120000;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  let res;
  try {
    res = await withTimeout(
      fetch(`${supabaseUrl}/functions/v1/claude-proxy`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }),
      timeoutMs
    );
  } catch (e) {
    if (String(e?.message || '').includes('Request timed out')) {
      throw new Error(
        `Claude took longer than ${Math.round(timeoutMs / 1000)}s to respond. ` +
          `For very long transcripts, try splitting into shorter sections.`
      );
    }
    throw e;
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude proxy ${res.status}: ${errBody.slice(0, 400)}`);
  }
  return res.json();
}

function firstText(result) {
  return result?.content?.[0]?.text?.trim() || '';
}

// Strip code-fence wrappers ("```json ... ```") that Claude sometimes
// adds, then JSON.parse. Throws with a readable message if the cleanup
// still doesn't yield valid JSON.
function parseClaudeJson(text) {
  if (!text) throw new Error('Claude returned no text.');
  let cleaned = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(cleaned);
  if (fence) cleaned = fence[1].trim();
  // Strip leading "Here is..." chatter before the first {  or [
  const firstBrace = cleaned.search(/[\[{]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      'Claude returned text that did not parse as JSON: ' +
        text.slice(0, 200) +
        (text.length > 200 ? '…' : '')
    );
  }
}

// =====================================================================
// splitTranscriptIntoChunks
// =====================================================================
//
// Long Plaud transcripts (1+ hour recordings → 10k+ words) reliably
// blow past Supabase Edge Functions' 150-second idle timeout when sent
// to Claude in a single call. The fix is to split the transcript at
// natural boundaries and run Claude on each chunk independently,
// accumulating segments in the DB as we go.
//
// Splitting strategy (cascading fallback):
//   1. Paragraph breaks (double newline) — most natural cut
//   2. Single newlines — works for transcripts without paragraph
//      separation but with line-by-line speaker turns
//   3. Sentence boundaries — last resort for big unbroken walls
//
// `maxWords` defaults to 2500 — comfortable for Claude to process in
// well under 60 seconds even with verbose segmentation output. Smaller
// chunks would be safer but multiply the round-trips. 2500 is a
// reasonable middle ground for the typical Plaud transcript profile.

export function splitTranscriptIntoChunks(text, maxWords = 2500) {
  const raw = (text || '').trim();
  if (!raw) return [];
  // Fast path: short enough to send as one chunk.
  if (countWords(raw) <= maxWords) return [raw];

  // Cascading splitter: paragraphs → lines → sentences → hard wrap.
  // Each pass tries to keep semantic units intact while staying under
  // the word budget.
  const units = splitIntoUnits(raw, maxWords);
  const chunks = [];
  let current = '';
  let currentWords = 0;
  for (const u of units) {
    const uWords = countWords(u);
    if (currentWords > 0 && currentWords + uWords > maxWords) {
      chunks.push(current);
      current = u;
      currentWords = uWords;
    } else {
      current = current ? current + '\n\n' + u : u;
      currentWords += uWords;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Recursive splitter: take a wall of text and break it into units
// each <= maxWords. Each layer of fallback only applies when the
// chosen separator still leaves units oversized.
function splitIntoUnits(text, maxWords) {
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paragraphs) {
    if (countWords(p) <= maxWords) {
      out.push(p);
      continue;
    }
    // Paragraph too big → try single newlines.
    const lines = p.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let buf = '';
    let bufWords = 0;
    for (const line of lines) {
      const lw = countWords(line);
      if (lw > maxWords) {
        // Line is itself too long; flush buffer, then split into sentences.
        if (buf) {
          out.push(buf);
          buf = '';
          bufWords = 0;
        }
        const sentences = line
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
        let sbuf = '';
        let sbufWords = 0;
        for (const s of sentences) {
          const sw = countWords(s);
          if (sw > maxWords) {
            // Single sentence still too long (very rare) — hard-wrap
            // by words. Last resort; preserves data, sacrifices
            // semantic boundary.
            if (sbuf) {
              out.push(sbuf);
              sbuf = '';
              sbufWords = 0;
            }
            const words = s.split(/\s+/);
            for (let i = 0; i < words.length; i += maxWords) {
              out.push(words.slice(i, i + maxWords).join(' '));
            }
            continue;
          }
          if (sbufWords + sw > maxWords && sbuf) {
            out.push(sbuf);
            sbuf = s;
            sbufWords = sw;
          } else {
            sbuf = sbuf ? sbuf + ' ' + s : s;
            sbufWords += sw;
          }
        }
        if (sbuf) out.push(sbuf);
      } else if (bufWords + lw > maxWords && buf) {
        out.push(buf);
        buf = line;
        bufWords = lw;
      } else {
        buf = buf ? buf + '\n' + line : line;
        bufWords += lw;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function countWords(s) {
  const t = (s || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

// =====================================================================
// segmentAndClassifyTranscript
// =====================================================================
//
// One pass: Claude reads the transcript, splits it into pastorally-
// meaningful segments, and proposes which destination(s) each segment
// belongs in. We deliberately keep this in a single call rather than
// splitting into "segment first, then classify" — Claude can do both
// in one prompt and the cost difference is real for daily use.
//
// Canonical destinations the pastor can route to (V1):
//
//   pastoral_interaction
//     A noteworthy moment with a parishioner — a hospital visit, a
//     conversation about a hard decision, a milestone. Becomes a
//     pastoral_interactions row.
//
//   pastoral_note
//     A short observation about a person worth remembering across
//     visits — "remember to ask about her grandson's wedding",
//     "he was tearful when his father came up". Becomes a
//     pastoral_notes row.
//
//   sermon_resource
//     An anecdote, quote, or observation that could become a sermon
//     illustration. Becomes a resources row in the Sermons app.
//
// A single segment can have MULTIPLE destinations — the prodigal-son-
// grandson example is both a pastoral note (about the family) AND a
// sermon resource. The prompt is explicit about this.
//
// `contextHint` is optional free text the pastor can supply ("from
// hospital rounds Tuesday afternoon") that helps Claude orient.

const SCHEMA_DESCRIPTION =
  'Return JSON in this exact shape (no other text, no code fences):\n' +
  '{\n' +
  '  "segments": [\n' +
  '    {\n' +
  '      "excerpt": string (verbatim slice of the transcript, ' +
  'preserving the pastor\'s own wording),\n' +
  '      "description": string (one short sentence summarising what\n' +
  '          this segment is about, written in the pastor\'s\n' +
  '          voice — e.g. "Visited Mrs. Johnson; she was worried\n' +
  '          about her grandson\'s job"),\n' +
  '      "proposed_destinations": array of one or more strings from:\n' +
  '          "pastoral_interaction", "pastoral_note", "sermon_resource",\n' +
  '      "mentioned_names": array of strings (people referenced by\n' +
  '          name — full names if used, otherwise as said),\n' +
  '      "rationale": string (one short sentence explaining why you\n' +
  '          classified it this way; cite a phrase from the segment\n' +
  '          if helpful)\n' +
  '    },\n' +
  '    ...\n' +
  '  ]\n' +
  '}\n';

const DESTINATION_RULES =
  'How to choose destinations:\n' +
  '- pastoral_interaction: a meaningful encounter with a parishioner\n' +
  '  (visit, conversation, phone call, observation of them during an\n' +
  '  event). Includes the substance of what was discussed.\n' +
  '- pastoral_note: a small observation worth remembering across\n' +
  '  visits — preferences, family details, a recurring concern, a\n' +
  '  detail the pastor would want to recall in three months. Shorter\n' +
  '  than an interaction.\n' +
  '- sermon_resource: an anecdote, story, quote, observation, or\n' +
  '  real-life parallel that could be drawn on in a future sermon.\n' +
  '  This is the only destination that has nothing to do with a\n' +
  '  specific parishioner — it lives in the sermon resource library.\n' +
  '\n' +
  'A single segment MAY have multiple destinations. For example, the\n' +
  'pastor recounting a visit where the parishioner shared a story that\n' +
  'could illustrate prodigal-son themes — that\'s both a\n' +
  'pastoral_interaction (about that visit) AND a sermon_resource\n' +
  '(the story itself).\n' +
  '\n' +
  'Segment boundaries: each segment should be ONE topical unit —\n' +
  'one conversation, one anecdote, one observation. Skip recording\n' +
  'fumbles, navigation chatter ("turn left here"), and meaningless\n' +
  'small talk. If a stretch has no pastoral or illustration value,\n' +
  'omit it entirely rather than emit a segment.\n' +
  '\n' +
  'Excerpt rules: preserve the pastor\'s own words. Light cleanup of\n' +
  'transcription artifacts ("um", "uh", repeated false starts) is\n' +
  'fine, but do not paraphrase. The pastor needs the segment to\n' +
  'read like what they actually said. Keep excerpts under ~400\n' +
  'words; if a topical unit is longer, summarise the middle inside\n' +
  '[…brackets like this…] but keep the opening and closing verbatim.';

export async function segmentAndClassifyTranscript({ text, contextHint = '' }) {
  const raw = (text || '').trim();
  if (!raw) throw new Error('No transcript text to segment.');

  const system =
    'You are helping a United Methodist pastor triage a daily audio\n' +
    'transcript (typically from a Plaud Note recorder) into structured\n' +
    'records. You will split it into pastorally-meaningful segments\n' +
    'and propose which downstream table each one should land in.\n' +
    '\n' +
    SCHEMA_DESCRIPTION +
    '\n' +
    DESTINATION_RULES +
    '\n\n' +
    'Output JSON only. No preamble. No code fences. If the transcript\n' +
    'contains nothing pastorally meaningful, return { "segments": [] }.';

  const userMsg =
    (contextHint ? `Context: ${contextHint}\n\n` : '') +
    'Transcript:\n' +
    raw;

  const result = await callClaude(
    {
      system,
      messages: [{ role: 'user', content: userMsg }],
      // Long transcripts can warrant a long response. 12k tokens is
      // about 9k words of output — plenty for a typical day.
      max_tokens: 12000,
    },
    { timeoutMs: 180000 }
  );
  const parsed = parseClaudeJson(firstText(result));
  if (!parsed || !Array.isArray(parsed.segments)) {
    throw new Error('Claude did not return a segments[] array.');
  }
  // Normalize: trim, drop obviously-empty segments, enforce that
  // destinations contains only the three canonical values.
  const VALID = new Set([
    'pastoral_interaction',
    'pastoral_note',
    'sermon_resource',
  ]);
  return {
    segments: parsed.segments
      .filter((s) => s && typeof s === 'object' && typeof s.excerpt === 'string')
      .map((s) => ({
        excerpt: s.excerpt.trim(),
        description:
          typeof s.description === 'string' ? s.description.trim() : '',
        proposed_destinations: Array.isArray(s.proposed_destinations)
          ? Array.from(
              new Set(
                s.proposed_destinations
                  .map((d) => (typeof d === 'string' ? d.trim() : ''))
                  .filter((d) => VALID.has(d))
              )
            )
          : [],
        mentioned_names: Array.isArray(s.mentioned_names)
          ? s.mentioned_names
              .map((n) => (typeof n === 'string' ? n.trim() : ''))
              .filter(Boolean)
          : [],
        rationale:
          typeof s.rationale === 'string' ? s.rationale.trim() : '',
      }))
      .filter((s) => s.excerpt.length > 0),
  };
}
