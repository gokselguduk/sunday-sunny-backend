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
  '1d': ohlcvLimit('OHLCV_LIMIT_1D', 1500),
  '1w': ohlcvLimit('OHLCV_LIMIT_1W', 120)
};

const regMaxMissedEnv = parseInt(process.env.REGISTRY_MAX_MISSED_SCANS, 10);
const priceRefreshEnv = parseInt(process.env.REGISTRY_PRICE_REFRESH_MS, 10);
const minFirsatEnv = parseInt(process.env.MIN_FIRSAT, 10);

const CONFIG = {
  SCAN_DELAY_MS: 1000,
  SCAN_INTERVAL_MS: 45 * 60 * 1000,
  /** Tahta eşiği yalnızca PPT motoru (`kriptoAnalizSistemi`) fırsat skoru; .env: MIN_FIRSAT */
  MIN_FIRSAT: Number.isFinite(minFirsatEnv) ? Math.min(95, Math.max(10, minFirsatEnv)) : 35,
  OHLCV_LIMITS,
  /** İki kline isteği arası (ms); rate limit + daha büyük yanıtlar için hafif artırıldı */
  OHLCV_REQUEST_GAP_MS: 250,
  /** Kaç tam tarama üst üste eşik altı kalınca tahtadan düşsün (silinmez, sadece API listesinden çıkar) */
  REGISTRY_MAX_MISSED_SCANS: Number.isFinite(regMaxMissedEnv)
    ? Math.min(50, Math.max(1, regMaxMissedEnv))
    : 8,
  /** Tam tarama dışı tahta fiyat yenilemesi (ms); 0 = kapalı. REGISTRY_PRICE_REFRESH_MS=0 */
  REGISTRY_PRICE_REFRESH_MS: Number.isFinite(priceRefreshEnv)
    ? Math.min(600000, Math.max(0, priceRefreshEnv))
    : 180000
};

module.exports = { CONFIG };
