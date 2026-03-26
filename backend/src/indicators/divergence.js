// Divergence Dedektörü — en erken reversal sinyali
// Fiyat yeni dip yaparken RSI yapmıyorsa = gizli güç (bullish divergence)
// Fiyat yeni zirve yaparken RSI yapmıyorsa = gizli zayıflık (bearish divergence)

function detectDivergence(candles, rsiValues) {
  if (!candles || candles.length < 20 || !rsiValues || rsiValues.length < 20) {
    return { bullish: false, bearish: false, hidden_bullish: false, hidden_bearish: false };
  }

  const lookback = 20;
  const prices   = candles.slice(-lookback).map(c => c.close);
  const rsi      = rsiValues.slice(-lookback);

  // Son 5 mum içinde pivot bul
  function findPivotLow(arr, idx) {
    if (idx < 2 || idx > arr.length - 3) return false;
    return arr[idx] < arr[idx-1] && arr[idx] < arr[idx-2] &&
           arr[idx] < arr[idx+1] && arr[idx] < arr[idx+2];
  }

  function findPivotHigh(arr, idx) {
    if (idx < 2 || idx > arr.length - 3) return false;
    return arr[idx] > arr[idx-1] && arr[idx] > arr[idx-2] &&
           arr[idx] > arr[idx+1] && arr[idx] > arr[idx+2];
  }

  // Bullish divergence: fiyat düşük dip, RSI yüksek dip
  let bullish        = false;
  let hidden_bullish = false;
  let bearish        = false;
  let hidden_bearish = false;

  for (let i = 5; i < lookback - 2; i++) {
    if (findPivotLow(prices, i)) {
      for (let j = i + 2; j < lookback - 2; j++) {
        if (findPivotLow(prices, j)) {
          // Regular bullish: fiyat daha düşük dip, RSI daha yüksek dip
          if (prices[j] < prices[i] && rsi[j] > rsi[i]) bullish = true;
          // Hidden bullish: fiyat daha yüksek dip, RSI daha düşük dip
          if (prices[j] > prices[i] && rsi[j] < rsi[i]) hidden_bullish = true;
        }
      }
    }
    if (findPivotHigh(prices, i)) {
      for (let j = i + 2; j < lookback - 2; j++) {
        if (findPivotHigh(prices, j)) {
          // Regular bearish: fiyat daha yüksek zirve, RSI daha düşük zirve
          if (prices[j] > prices[i] && rsi[j] < rsi[i]) bearish = true;
          // Hidden bearish: fiyat daha düşük zirve, RSI daha yüksek zirve
          if (prices[j] < prices[i] && rsi[j] > rsi[i]) hidden_bearish = true;
        }
      }
    }
  }

  return { bullish, bearish, hidden_bullish, hidden_bearish };
}

module.exports = { detectDivergence };