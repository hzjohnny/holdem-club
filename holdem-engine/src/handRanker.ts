/**
 * Hand evaluator.
 *
 * Strength is returned as a single comparable integer:
 *   - high 8 bits: category (8 = straight flush ... 0 = high card)
 *   - low 24 bits: kicker tuple, most significant kicker first.
 *
 * evaluate5  is the canonical 5-card evaluator (O(1) bit tricks, no nested loops
 * over combinations). evaluate7 enumerates C(7,5)=21 5-card subsets and keeps
 * the maximum — this is the standard, fast-enough approach for a game engine.
 */

import { rankOf, suitOf } from './card.js';

const CATEGORY_OFFSET = 1_000_000;

const CAT_HIGH_CARD = 0;
const CAT_PAIR = 1;
const CAT_TWO_PAIR = 2;
const CAT_TRIPS = 3;
const CAT_STRAIGHT = 4;
const CAT_FLUSH = 5;
const CAT_FULL_HOUSE = 6;
const CAT_QUADS = 7;
const CAT_STRAIGHT_FLUSH = 8;

/**
 * Given a 13-bit rank bitmask, return the high rank of a straight, or -1.
 * Wheel (A-2-3-4-5) is treated as a 5-high straight (high rank = index of 5 = 3).
 */
function straightHigh(rankBits: number): number {
  // Wheel: A(12) + 2(0) + 3(1) + 4(2) + 5(3)
  if (rankBits === 0x100f) return 3;
  for (let hi = 12; hi >= 4; hi--) {
    // five consecutive bits ending at hi
    const mask = 0x1f << (hi - 4);
    if ((rankBits & mask) === mask) return hi;
  }
  return -1;
}

/**
 * Evaluate exactly 5 cards. Returns a strength integer.
 */
export function evaluate5(cards: readonly number[]): number {
  let rankBits = 0;
  const rankCount = new Array<number>(13).fill(0);
  let suitMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankBits |= 1 << r;
    rankCount[r]++;
    suitMask |= 1 << s;
  }
  const isFlush = (suitMask & (suitMask - 1)) === 0;
  const sh = straightHigh(rankBits);

  if (isFlush && sh >= 0) return CAT_STRAIGHT_FLUSH * CATEGORY_OFFSET + sh;

  // Build sorted frequency list: [count, rank], sorted desc by count then rank.
  const freq: Array<[number, number]> = [];
  for (let r = 12; r >= 0; r--) {
    if (rankCount[r] > 0) freq.push([rankCount[r], r]);
  }
  freq.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));

  // Quads
  if (freq[0][0] === 4) {
    return CAT_QUADS * CATEGORY_OFFSET + freq[0][1] * 15 + freq[1][1];
  }
  // Full house
  if (freq[0][0] === 3 && freq[1][0] === 2) {
    return CAT_FULL_HOUSE * CATEGORY_OFFSET + freq[0][1] * 15 + freq[1][1];
  }
  // Flush
  if (isFlush) {
    let v = 0;
    for (const [, r] of freq) v = v * 15 + r;
    return CAT_FLUSH * CATEGORY_OFFSET + v;
  }
  // Straight
  if (sh >= 0) return CAT_STRAIGHT * CATEGORY_OFFSET + sh;
  // Trips
  if (freq[0][0] === 3) {
    let v = freq[0][1];
    for (let i = 1; i < freq.length; i++) v = v * 15 + freq[i][1];
    return CAT_TRIPS * CATEGORY_OFFSET + v;
  }
  // Two pair
  if (freq[0][0] === 2 && freq[1][0] === 2) {
    return (
      CAT_TWO_PAIR * CATEGORY_OFFSET +
      freq[0][1] * 15 * 15 +
      freq[1][1] * 15 +
      freq[2][1]
    );
  }
  // Pair
  if (freq[0][0] === 2) {
    let v = freq[0][1];
    for (let i = 1; i < freq.length; i++) v = v * 15 + freq[i][1];
    return CAT_PAIR * CATEGORY_OFFSET + v;
  }
  // High card
  let v = 0;
  for (const [, r] of freq) v = v * 15 + r;
  return CAT_HIGH_CARD * CATEGORY_OFFSET + v;
}

/**
 * Evaluate 7 cards (2 hole + 5 board). Returns the best 5-card strength.
 * Enumerates all 21 subsets; correctness over micro-optimisation.
 */
export function evaluate7(cards: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 5; k++) {
        for (let l = k + 1; l < 6; l++) {
          for (let m = l + 1; m < 7; m++) {
            const v = evaluate5([cards[i], cards[j], cards[k], cards[l], cards[m]]);
            if (v > best) best = v;
          }
        }
      }
    }
  }
  return best;
}

const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
] as const;

export function categoryOf(handRank: number): number {
  return Math.floor(handRank / CATEGORY_OFFSET);
}

export function categoryName(handRank: number): string {
  return CATEGORY_NAMES[categoryOf(handRank)];
}
