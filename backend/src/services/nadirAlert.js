const memory = require('./memory');
const firsatTiers = require('./firsatTiers');

const TZ = process.env.NADIR_ALERT_TZ || 'Europe/Istanbul';
const COOLDOWN_MS = parseInt(process.env.NADIR_PUSH_COOLDOWN_MS ?? String(45 * 60 * 1000), 10);

function getHourInTz(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false });
  const parts = fmt.formatToParts(date);
  const h = parts.find((p) => p.type === 'hour');
  return h ? parseInt(h.value, 10) : 0;
}

function isNightSilentHour() {
  const start = parseInt(process.env.NIGHT_SILENT_START_HOUR ?? '23', 10);
  const end = parseInt(process.env.NIGHT_SILENT_END_HOUR ?? '7', 10);
  const h = getHourInTz();
  if (start > end) return h >= start || h < end;
  return h >= start && h < end;
}

function pickNadirSignals(signals) {
  const min = firsatTiers.NADIR_MIN_SCORE;
  return signals
    .filter((s) => (s.firsatSkoru?.skor || 0) >= min)
    .sort((a, b) => (b.firsatSkoru?.skor || 0) - (a.firsatSkoru?.skor || 0));
}

function buildNadirPushMessage(nadirSigs) {
  const best = nadirSigs[0];
  const bestScore = best.firsatSkoru?.skor ?? 0;
  const bestName = best.symbol?.replace('USDT', '') || '?';
  const others = nadirSigs.length - 1;
  const body = others > 0
    ? `En yüksek: ${bestName} ${bestScore} puan | +${others} Nadir daha`
    : `En yüksek: ${bestName} ${bestScore} puan`;
  return {
    title: '🔥 NADIR FIRSAT',
    body,
    bestName,
    bestScore,
    total: nadirSigs.length
  };
}

async function shouldSendNadirPush() {
  if (isNightSilentHour()) return { ok: false, reason: 'silent' };
  const last = await memory.getNadirPushLastAt();
  if (last) {
    const elapsed = Date.now() - new Date(last).getTime();
    if (elapsed < COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', waitMs: COOLDOWN_MS - elapsed };
    }
  }
  return { ok: true };
}

async function markNadirPushSent() {
  await memory.setNadirPushLastAt(new Date().toISOString());
}

function getNadirAlertConfigForClient() {
  return {
    timezone: TZ,
    nightSilent: {
      startHour: parseInt(process.env.NIGHT_SILENT_START_HOUR ?? '23', 10),
      endHour: parseInt(process.env.NIGHT_SILENT_END_HOUR ?? '7', 10)
    },
    nadirCooldownMs: COOLDOWN_MS,
    ...firsatTiers.forClient()
  };
}

module.exports = {
  pickNadirSignals,
  buildNadirPushMessage,
  shouldSendNadirPush,
  markNadirPushSent,
  isNightSilentHour,
  getNadirAlertConfigForClient,
  getHourInTz
};
