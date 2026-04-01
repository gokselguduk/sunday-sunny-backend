/**
 * PPT fırsat skoru dilimleri — UI, push, Redis trail ve rapor aynı kaynaktan.
 * Railway: NADIR_MIN_SCORE, GUCLU_MIN_SCORE, IYI_MIN_SCORE
 */
function resolveTiers() {
  let nadir = Math.min(95, Math.max(65, parseInt(process.env.NADIR_MIN_SCORE, 10) || 72));
  let guclu = Math.min(92, Math.max(48, parseInt(process.env.GUCLU_MIN_SCORE, 10) || 62));
  let iyi = Math.min(80, Math.max(30, parseInt(process.env.IYI_MIN_SCORE, 10) || 50));
  if (guclu >= nadir) guclu = Math.max(48, nadir - 2);
  if (iyi >= guclu) iyi = Math.max(30, guclu - 2);
  return { nadir, guclu, iyi };
}

const T = resolveTiers();
const NADIR_MIN_SCORE = T.nadir;
const GUCLU_MIN_SCORE = T.guclu;
const IYI_MIN_SCORE = T.iyi;

function classifyTier(firsatSkor) {
  if (typeof firsatSkor !== 'number' || !Number.isFinite(firsatSkor)) return null;
  if (firsatSkor >= NADIR_MIN_SCORE) return 'nadir';
  if (firsatSkor >= GUCLU_MIN_SCORE) return 'guclu';
  if (firsatSkor >= IYI_MIN_SCORE) return 'iyi';
  return null;
}

function forClient() {
  return {
    nadirMin: NADIR_MIN_SCORE,
    gucluMin: GUCLU_MIN_SCORE,
    iyiMin: IYI_MIN_SCORE
  };
}

module.exports = {
  NADIR_MIN_SCORE,
  GUCLU_MIN_SCORE,
  IYI_MIN_SCORE,
  classifyTier,
  forClient
};
