function analyzeVolume(candles) {
  const volumes = candles.map(c => c.volume);
  const avg20   = volumes.slice(-20).reduce((a,b)=>a+b,0) / 20;
  const avg5    = volumes.slice(-5).reduce((a,b)=>a+b,0) / 5;
  const last    = volumes[volumes.length-1];
  const ratio   = avg20 > 0 ? parseFloat((last/avg20).toFixed(2)) : 1;
  const trend   = avg5 > avg20 * 1.2 ? 'ARTIYOR' : avg5 < avg20 * 0.8 ? 'AZALIYOR' : 'NORMAL';

  return {
    lastVolume: last,
    avgVolume:  parseFloat(avg20.toFixed(2)),
    ratio:      ratio,
    trend:      trend,
    isHigh:     ratio >= 1.5,
    isMedium:   ratio >= 1.0 && ratio < 1.5,
    isLow:      ratio < 1.0
  };
}

module.exports = { analyzeVolume };