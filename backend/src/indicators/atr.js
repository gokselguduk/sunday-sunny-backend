function calculateATR(candles, period) {
  if (!period) period = 14;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low  - candles[i-1].close)
    );
    trs.push(tr);
  }
  let atr = trs.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period-1) + trs[i]) / period;
  }
  return {
    lastATR:    parseFloat(atr.toFixed(4)),
    atrPercent: parseFloat((atr / candles[candles.length-1].close * 100).toFixed(2))
  };
}

module.exports = { calculateATR };