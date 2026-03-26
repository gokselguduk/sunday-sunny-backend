function calculateStochRSI(closes, period) {
  if (!period) period = 14;
  const { calculateRSI } = require('./rsi');
  const rsi = calculateRSI(closes, period);
  const result = [];
  for (let i = period - 1; i < rsi.length; i++) {
    const slice  = rsi.slice(i - period + 1, i + 1);
    const minRSI = Math.min(...slice);
    const maxRSI = Math.max(...slice);
    const k = maxRSI === minRSI ? 0 : (rsi[i] - minRSI) / (maxRSI - minRSI) * 100;
    result.push(parseFloat(k.toFixed(2)));
  }
  const lastK = result[result.length - 1] || 50;
  const prevK = result[result.length - 2] || 50;
  const lastD = result.slice(-3).reduce((a,b)=>a+b,0) / 3;
  return { lastK, prevK, lastD: parseFloat(lastD.toFixed(2)) };
}

module.exports = { calculateStochRSI };