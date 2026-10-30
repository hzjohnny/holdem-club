/**
 * Card representation: numeric id 0..51.
 *   rank = floor(id / 4)  -> 0=2, 1=3, ..., 12=Ace
 *   suit = id % 4        -> 0=spades, 1=hearts, 2=diamonds, 3=clubs
 *
 * Pure functions only. No DOM / no Node APIs required.
 */

export const RANKS = 13;
export const SUITS = 4;
export const CARDS = 52;

export const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;

export function rankOf(card: number): number {
  return Math.floor(card / SUITS);
}

export function suitOf(card: number): number {
  return card % SUITS;
}

export function makeCard(rank: number, suit: number): number {
  return rank * SUITS + suit;
}

export function makeDeck(): number[] {
  const deck: number[] = [];
  for (let rank = 0; rank < RANKS; rank++) {
    for (let suit = 0; suit < SUITS; suit++) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Accepts an injectable rng for deterministic tests. */
export function shuffle(deck: number[], rng: () => number = Math.random): number[] {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = d[i];
    d[i] = d[j];
    d[j] = tmp;
  }
  return d;
}

export function cardToString(card: number): string {
  return RANK_NAMES[rankOf(card)] + SUIT_SYMBOLS[suitOf(card)];
}

/** Mulberry32 PRNG factory — deterministic, useful for tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
