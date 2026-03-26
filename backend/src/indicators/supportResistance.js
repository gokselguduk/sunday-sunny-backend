function findSupportResistance(candles) {
  const slice  = candles.slice(-100);
  const last   = candles[candles.length-1].close;
  const pivots = [];

  for (let i = 2; i < slice.length - 2; i++) {
    const high = slice[i].high;
    const low  = slice[i].low;
    const isHighPivot = high > slice[i-1].high && high > slice[i-2].high &&
                        high > slice[i+1].high && high > slice[i+2].high;
    const isLowPivot  = low  < slice[i-1].low  && low  < slice[i-2].low  &&
                        low  < slice[i+1].low   && low  < slice[i+2].low;
    if (isHighPivot) pivots.push({ type: 'resistance', price: high });
    if (isLowPivot)  pivots.push({ type: 'support',    price: low  });
  }

  const supports    = pivots.filter(p => p.type === 'support'    && p.price < last).map(p => p.price);
  const resistances = pivots.filter(p => p.type === 'resistance' && p.price > last).map(p => p.price);

  const nearestSupport    = supports.length    > 0 ? Math.max(...supports)    : null;
  const nearestResistance = resistances.length > 0 ? Math.min(...resistances) : null;

  const supportDistance    = nearestSupport    ? parseFloat(((last - nearestSupport)    / last * 100).toFixed(2)) : null;
  const resistanceDistance = nearestResistance ? parseFloat(((nearestResistance - last) / last * 100).toFixed(2)) : null;

  return { nearestSupport, nearestResistance, supportDistance, resistanceDistance };
}

module.exports = { findSupportResistance };