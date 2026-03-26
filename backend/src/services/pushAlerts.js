/**
 * Tarama tamamlanınca: Fear & Greed belirgin yükselişi ve güçlü sinyallerde canlı fiyatın
 * SL–son kapanış “alış bandı”na girmesi için push (VAPID abonelikleri).
 */

const memory = require('./memory');
const binance = require('./binance');
const nadirAlert = require('./nadirAlert');
const notifier = require('./notifier');

const FG_MIN_DELTA = Math.max(1, parseInt(process.env.FG_PUSH_MIN_DELTA || '5', 10));
const FG_COOLDOWN_MS = Math.max(600000, parseInt(process.env.FG_PUSH_COOLDOWN_MS || String(2 * 60 * 60 * 1000), 10));
const BUY_MIN_FIRSAT = Math.max(50, parseInt(process.env.BUY_ZONE_MIN_FIRSAT || '68', 10));
const BUY_COOLDOWN_MS = Math.max(1800000, parseInt(process.env.BUY_ZONE_COOLDOWN_MS || String(6 * 60 * 60 * 1000), 10));
const BUY_PRICE_BUFFER = Math.min(0.02, Math.max(0.0005, parseFloat(process.env.BUY_ZONE_BUFFER_PCT || '0.004')));

function isNightSilent() {
  try {
    return nadirAlert.isNightSilentHour();
  } catch (_) {
    return false;
  }
}

async function maybePushFgRise(currentFg) {
  if (isNightSilent()) return;
  const prevRaw = await memory.getAlertMeta('fg_snapshot');
  const prev = prevRaw != null ? parseInt(prevRaw, 10) : null;
  await memory.setAlertMeta('fg_snapshot', String(currentFg));

  if (prev == null || !Number.isFinite(prev)) return;
  const rise = currentFg - prev;
  if (rise < FG_MIN_DELTA) return;

  const lastPush = await memory.getAlertMeta('fg_push_at');
  if (lastPush) {
    const elapsed = Date.now() - new Date(lastPush).getTime();
    if (elapsed < FG_COOLDOWN_MS) return;
  }

  await notifier.sendPushToAll({
    title: '📈 Fear & Greed yükseldi',
    body: `Endeks ${prev} → ${currentFg} (+${rise}). Piyasa duyarlılığı güçleniyor olabilir; yatırım tavsiyesi değildir.`,
    url: '/',
    tag: 'ss-fg-rise',
    vibrate: [200, 80, 200]
  });
  await memory.setAlertMeta('fg_push_at', new Date().toISOString());
  console.log(`Push: F&G rise ${prev}→${currentFg}`);
}

async function maybePushBuyZones(freshSignals) {
  if (isNightSilent()) return;

  const candidates = freshSignals
    .filter((s) => (s.firsatSkoru?.skor || 0) >= BUY_MIN_FIRSAT)
    .filter((s) => s.overallSignal === 'BUY' || s.overallSignal === 'STRONG_BUY')
    .filter((s) => {
      const sl = s.atr?.stopLoss;
      const lc = s.lastClose;
      return sl != null && lc != null && Number.isFinite(sl) && Number.isFinite(lc) && lc > sl;
    })
    .sort((a, b) => (b.firsatSkoru?.skor || 0) - (a.firsatSkoru?.skor || 0))
    .slice(0, 14);

  if (!candidates.length) return;

  const symbols = candidates.map((s) => s.symbol).filter(Boolean);
  const prices = await binance.getMarkPricesBulk(symbols, 55);

  for (const s of candidates) {
    const sym = s.symbol;
    const px = prices[sym];
    if (px == null || !Number.isFinite(px)) continue;

    const sl = s.atr.stopLoss;
    const lc = s.lastClose;
    const low = sl * (1 - BUY_PRICE_BUFFER);
    const high = lc * (1 + BUY_PRICE_BUFFER);
    if (px < low || px > high) continue;

    const ck = `buyzone:${sym}`;
    const lastAt = await memory.getAlertMeta(ck);
    if (lastAt) {
      const elapsed = Date.now() - new Date(lastAt).getTime();
      if (elapsed < BUY_COOLDOWN_MS) continue;
    }

    const short = sym.replace('USDT', '');
    await notifier.sendPushToAll({
      title: `🎯 ${short} · Alış bandı`,
      body: `Fiyat ~$${px.toFixed(px >= 100 ? 2 : 4)} (SL–son analiz aralığında). Fırsat ${s.firsatSkoru?.skor ?? '—'}. Yatırım tavsiyesi değildir.`,
      url: '/',
      tag: `ss-buyzone-${sym}`,
      vibrate: [180, 100, 180, 100, 280]
    });
    await memory.setAlertMeta(ck, new Date().toISOString());
    console.log(`Push: buy zone ${sym} px=${px}`);
  }
}

/**
 * @param {Array} signals — tarama sonrası tam liste (absent olanlar dahil)
 */
async function processScanComplete(signals) {
  const fresh = (signals || []).filter((s) => !s.absentThisScan);

  let sentiment = fresh[0]?.sentiment;
  if (!sentiment) {
    try {
      sentiment = await binance.getFearGreed();
    } catch (_) {
      return;
    }
  }
  const fg = parseInt(sentiment.value, 10);
  if (!Number.isFinite(fg)) return;

  await maybePushFgRise(fg);
  await maybePushBuyZones(fresh);
}

module.exports = { processScanComplete };
