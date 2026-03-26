function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i-1] * (1-k));
  }
  return result;
}

function calculateMACD(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd  = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macd, 9);
  const histogram = macd.map((v, i) => v - signal[i]);
  return { macd, signal, histogram };
}

module.exports = { calculateMACD };