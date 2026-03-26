function analyzeOrderBook(depth) {
  try {
    const bids = depth.bids.map((b) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }));
    const asks = depth.asks.map((a) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }));
    const totalBid = bids.reduce((t, b) => t + b.qty, 0);
    const totalAsk = asks.reduce((t, a) => t + a.qty, 0);
    const ratio = totalAsk > 0 ? parseFloat((totalBid / totalAsk).toFixed(3)) : 1;
    const maxBid = bids.reduce((mx, b) => (b.qty > mx.qty ? b : mx), bids[0] || { qty: 0 });
    const maxAsk = asks.reduce((mx, a) => (a.qty > mx.qty ? a : mx), asks[0] || { qty: 0 });
    const buyWall = totalBid > 0 && maxBid.qty > totalBid * 0.3;
    const sellWall = totalAsk > 0 && maxAsk.qty > totalAsk * 0.3;
    const delta = (totalBid - totalAsk) / (totalBid + totalAsk || 1);

    let obScore = 0;
    if (ratio > 1.5) obScore += 2;
    if (ratio > 2.0) obScore += 1;
    if (ratio < 0.67) obScore -= 2;
    if (buyWall) obScore += 1;
    if (sellWall) obScore -= 1;

    return {
      bidAskRatio: ratio,
      totalBid,
      totalAsk,
      buyWall,
      sellWall,
      buyWallPrice: buyWall ? maxBid.price : null,
      sellWallPrice: sellWall ? maxAsk.price : null,
      bullish: ratio > 1.3 && !sellWall,
      bearish: ratio < 0.7 && !buyWall,
      deltaRatio: parseFloat(delta.toFixed(3)),
      orderFlowScore: obScore,
      cvd: {
        deltaRatio: parseFloat(delta.toFixed(3)),
        bullish: delta > 0.1,
        bearish: delta < -0.1
      }
    };
  } catch (err) {
    return {
      bidAskRatio: 1,
      buyWall: false,
      sellWall: false,
      bullish: false,
      bearish: false,
      orderFlowScore: 0
    };
  }
}

module.exports = { analyzeOrderBook };
