/**
 * Four bot archetypes. Each returns an Action given the engine state and legal moves.
 * Pure functions — BotController injects delay and applies the result.
 *
 *   Shark  — tight-aggressive: premium hands, raises for value, bluffs rarely.
 *   Maniac — loose-aggressive: raises any two cards, applies pressure.
 *   Rock   — tight-passive: only plays big pairs / big cards, calls or folds.
 *   Fox    — loose-passive: calls liberally, traps with strong hands.
 */

import type { Action, GameState, LegalActions, Player } from 'holdem-engine';
import { getLegalActions } from 'holdem-engine';

export type BotPersonality = 'shark' | 'maniac' | 'rock' | 'fox';

export function randomPersonality(rng: () => number): BotPersonality {
  const r = rng();
  if (r < 0.25) return 'shark';
  if (r < 0.5) return 'maniac';
  if (r < 0.75) return 'rock';
  return 'fox';
}

interface HandStrength {
  score: number; // 0..1, preflop heuristic
}

function preflopStrength(p: Player): HandStrength {  if (!p.holeCards) return { score: 0 };
  const [c1, c2] = p.holeCards;
  const r1 = Math.floor(c1 / 4);
  const r2 = Math.floor(c2 / 4);
  const s1 = c1 % 4;
  const s2 = c2 % 4;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const suited = s1 === s2;
  const gap = hi - lo;

  let score = 0;
  if (hi === lo) {
    // pair
    score = 0.6 + (hi / 12) * 0.4; // pairs 0.6..1.0
  } else {
    // high card base
    score = 0.2 + (hi / 12) * 0.2;
    if (suited) score += 0.08;
    if (gap === 1) score += 0.06;
    if (gap === 2) score += 0.03;
    if (hi >= 10 && lo >= 8) score += 0.1; // broadway
  }
  return { score: Math.min(score, 1) };
}

function postflopStrength(p: Player): number {
  // Heuristic: use handRank from engine if available, else rough estimate.
  if (p.handRank !== undefined) {
    // handRank is category*1e6 + kickers. Normalize category to 0..1.
    return Math.floor(p.handRank / 1e6) / 8;
  }
  return 0.3;
}

export function decideBotAction(
  state: GameState,
  playerId: string,
  personality: BotPersonality,
  rng: () => number,
): Action {
  const legal: LegalActions = getLegalActions(state, playerId);
  const p: Player = state.players.find((pl: Player) => pl.id === playerId)!;

  const strength =
    state.board.length >= 3 ? postflopStrength(p) : preflopStrength(p).score;

  // No bet to face.
  if (legal.canCheck) {
    switch (personality) {
      case 'shark':
        if (strength > 0.65 && legal.canRaise && rng() < 0.7) return raiseIt(legal);
        if (rng() < 0.15) return { type: 'check' };
        return { type: 'check' };
      case 'maniac':
        if (legal.canRaise && rng() < 0.55) return raiseIt(legal);
        return { type: 'check' };
      case 'rock':
        return { type: 'check' };
      case 'fox':
        if (strength > 0.8 && legal.canRaise && rng() < 0.3) return raiseIt(legal);
        return { type: 'check' };
    }
  }

  // Facing a bet.
  const potOdds = legal.callAmount / Math.max(state.pot + legal.callAmount, 1);
  switch (personality) {
    case 'shark':
      if (strength > 0.85 && legal.canRaise && rng() < 0.6) return raiseIt(legal);
      if (strength > 0.55 && potOdds < 0.5) return { type: 'call' };
      if (strength > 0.7) return { type: 'call' };
      return { type: 'fold' };
    case 'maniac':
      if (legal.canRaise && rng() < 0.4) return raiseIt(legal);
      if (rng() < 0.6) return { type: 'call' };
      return { type: 'fold' };
    case 'rock':
      if (strength > 0.75) return { type: 'call' };
      return { type: 'fold' };
    case 'fox':
      if (strength > 0.85 && legal.canRaise && rng() < 0.4) return raiseIt(legal);
      if (potOdds < 0.7) return { type: 'call' };
      if (strength > 0.4) return { type: 'call' };
      return { type: 'fold' };
  }
}

function raiseIt(legal: LegalActions): Action {
  // Small raise sizing: minRaiseTo, occasionally all-in for variety.
  if (legal.canAllIn && Math.random() < 0.03) return { type: 'allin' };
  return { type: 'raise', to: legal.minRaiseTo };
}
