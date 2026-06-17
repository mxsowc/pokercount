// pokercount — poker pot-resolution engine.
//
// Public entry point. The one function you usually need is resolve(); the rest
// are exported for testing and for building higher-level tooling.

export { resolve } from './resolve.js';
export { buildPots } from './sidepots.js';
export { bestHigh, bestLow } from './select.js';
export {
  scoreHigh5,
  scoreLow8_5,
  bestHighOf,
  bestLowOf,
  highHandName,
  lowHandName,
  HIGH,
  cmp,
} from './evaluate.js';
export { computeSettlement } from './settle.js';
export { divide } from './money.js';
export { parseCard, parseCards, cardToString, combinations } from './cards.js';
