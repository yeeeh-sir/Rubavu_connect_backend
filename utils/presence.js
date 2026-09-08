const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

function isOnline(row) {
  if (!row) return 0;
  if (Number(row.show_online) === 0) return 0;
  if (!row.last_active_at) return 0;
  const last = new Date(row.last_active_at).getTime();
  if (Number.isNaN(last)) return 0;
  return Date.now() - last <= ONLINE_THRESHOLD_MS ? 1 : 0;
}

function withPresence(row, extra = {}) {
  if (!row) return row;
  return { ...row, ...extra, is_online: isOnline(row) };
}

module.exports = { isOnline, withPresence, ONLINE_THRESHOLD_MS };