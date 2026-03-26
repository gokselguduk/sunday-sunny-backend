function calculateRSI(closes, period) {
  if (!period) period = 14;
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a,b)=>a+b,0) / period;
  let avgLoss = losses.slice(0, period).reduce((a,b)=>a+b,0) / period;
  const rsi = [];
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period-1) + gains[i]) / period;
    avgLoss = (avgLoss * (period-1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(parseFloat((100 - 100/(1+rs)).toFixed(2)));
  }
  return rsi;
}
module.exports = { calculateRSI };