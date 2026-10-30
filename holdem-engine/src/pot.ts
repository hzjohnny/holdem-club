/**
 * Side-pot builder.
 *
 * Given players with `totalBet` and `folded` flags, produce the layered pots.
 * A player who folded still contributes chips to the layers they paid into,
 * but is NOT eligible to win any layer.
 */

import type { Player, SidePot } from './types.js';

export function buildSidePots(players: readonly Player[]): SidePot[] {
  // Collect every distinct totalBet level that has chips in play.
  const levels = new Set<number>();
  for (const p of players) {
    if (p.totalBet > 0) levels.add(p.totalBet);
  }
  const sorted = [...levels].sort((a, b) => a - b);

  const pots: SidePot[] = [];
  let prev = 0;
  for (const level of sorted) {
    const layer = level - prev;
    if (layer <= 0) {
      prev = level;
      continue;
    }
    // Every player who has paid at least `level` contributes `layer` to this pot.
    let amount = 0;
    for (const p of players) {
      if (p.totalBet >= level) amount += layer;
    }
    // Eligible = non-folded players who paid at least `level`.
    const eligible = players
      .filter((p) => !p.folded && p.totalBet >= level)
      .map((p) => p.id);

    if (amount > 0) {
      pots.push({ amount, eligiblePlayerIds: eligible });
    }
    prev = level;
  }
  return pots;
}

/** Sum of all side-pot amounts. */
export function totalPot(pots: readonly SidePot[]): number {
  return pots.reduce((s, p) => s + p.amount, 0);
}
