/**
 * Drop AI topic tags that are not supported by the employee transcript.
 * Tamil "காத்து" is often air/ventilation, not "waiting time".
 */

const WAITING_TOPIC_RE = /\b(waiting\s*time|wait\s*time|long\s+wait|queue|queued)\b/i;
/** Tamil: waiting-in-line style (not standalone காத்து = air). */
const WAITING_TA_RE = /காத்திருப்பு|காத்து\s*நேர|வெயிட்|நீண்ட\s*காத்து/i;

function transcriptMentionsWaiting(text) {
  const s = String(text || "");
  if (!s.trim()) return false;
  if (WAITING_TOPIC_RE.test(s)) return true;
  if (WAITING_TA_RE.test(s)) return true;
  return false;
}

function topicImpliesWaiting(topic) {
  return /\bwait(ing)?\b/i.test(String(topic || ""));
}

/**
 * @param {string[]} topics
 * @param {string} comments full STT / employee text
 * @returns {string[]}
 */
export function filterAiTopicsForTranscript(topics, comments) {
  const list = Array.isArray(topics) ? topics.map((t) => String(t).trim()).filter(Boolean) : [];
  if (!list.length) return [];
  const mentionsWait = transcriptMentionsWaiting(comments);
  return list.filter((topic) => {
    if (topicImpliesWaiting(topic) && !mentionsWait) return false;
    return true;
  });
}
