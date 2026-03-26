function ohlcvLimit(envKey, fallback) {
  const n = parseInt(process.env[envKey], 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1500, Math.max(50, n));
}

/**
 * Mum derinliği: 15m kısa (gürültü), 1h orta, 4h/1d uzun (trend / destek).
 * Geri almak için Railway’de: OHLCV_LIMIT_15M=500 OHLCV_LIMIT_1H=500 … veya kodu eski haline çevirin.
 */
const OHLCV_LIMITS = {
  '15m': ohlcvLimit('OHLCV_LIMIT_15M', 400),
  '1h': ohlcvLimit('OHLCV_LIMIT_1H', 1000),
  '4h': ohlcvLimit('OHLCV_LIMIT_4H', 1500),
  '1d': ohlcvLimit('OHLCV_LIMIT_1D', 1500)
};

const minScoreEnv = parseInt(process.env.MIN_SCORE, 10);

const CONFIG = {
  SCAN_DELAY_MS: 1000,
  SCAN_INTERVAL_MS: 45 * 60 * 1000,
  /** 1h skor + MTF + ek katkılar; çift sayım kaldırıldı — çok az sinyal kalırsa .env ile MIN_SCORE=1 deneyin */
  MIN_SCORE: Number.isFinite(minScoreEnv) ? Math.min(15, Math.max(0, minScoreEnv)) : 2,
  MIN_FIRSAT: 35,
  OHLCV_LIMITS,
  /** İki kline isteği arası (ms); rate limit + daha büyük yanıtlar için hafif artırıldı */
  OHLCV_REQUEST_GAP_MS: 250
};

module.exports = { CONFIG };
