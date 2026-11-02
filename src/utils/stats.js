/**
 * Response-time stats. A "response" = time from the first unanswered user message
 * to the next staff reply. Internal notes and deleted replies don't count.
 */
function responseStats(messages) {
  const deltas = [];
  let waitingSince = null;
  for (const m of messages) {
    if (m.internal || m.deleted) continue;
    const at = new Date(m.at).getTime();
    if (!m.staff) {
      if (waitingSince == null) waitingSince = at;
    } else if (waitingSince != null) {
      deltas.push(Math.max(0, at - waitingSince));
      waitingSince = null;
    }
  }
  return {
    avgResponseMs: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    firstResponseMs: deltas.length ? deltas[0] : null,
    responses: deltas.length,
  };
}

const average = (values) => {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

module.exports = { responseStats, average };
