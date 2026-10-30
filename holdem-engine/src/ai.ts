/**
 * Minimal bot policy.
 *
 * This is intentionally dumb — it just folds / calls / random-raises based on
 * pot odds and hand strength. Its only job at stage 1 is to prove that the
 * engine drives a full hand (preflop -> showdown) with zero human input.
 * A real poker bot arrives in stage 2 (Colyseus room).
 */

import { evaluate7 } from './handRanker.js';
import type { Action, GameState, Player } from './types.js';
import { applyAction, getLegalActions } from './engine.js';

function quickHandRank(state: GameState, p: Player): number {
  if (!p.holeCards) return 0;
  if (state.board.length >= 3) {
    return evaluate7([p.holeCards[0], p.holeCards[1], ...state.board]);
  }
  // Preflop heuristic: pair > big cards > others.
  const [c1, c2] = p.holeCards;
  const r1 = Math.floor(c1 / 4);
  const r2 = Math.floor(c2 / 4);
  if (r1 === r2) return 1_000_000 + r1;
  return Math.max(r1, r2) * 15 + Math.min(r1, r2);
}

export function decideBotAction(state: GameState, playerId: string, rng: () => number = Math.random): Action {
  const legal = getLegalActions(state, playerId);
  if (legal.canCheck) {
    // Randomly raise sometimes for action.
    if (legal.canRaise && rng() < 0.15) {
      return { type: 'raise', to: legal.minRaiseTo };
    }
    return { type: 'check' };
  }
  if (legal.canFold && !legal.canCall) return { type: 'fold' };

  const p = state.players.find((pl) => pl.id === playerId)!;
  const strength = quickHandRank(state, p);
  const potOdds = legal.callAmount / Math.max(state.pot + legal.callAmount, 1);

  if (legal.canAllIn && strength > 7_000_000 && rng() < 0.1) return { type: 'allin' };
  if (legal.canRaise && strength > 5_000_000 && rng() < 0.4) {
    return { type: 'raise', to: legal.minRaiseTo };
  }
  if (potOdds < 0.55 || strength > 1_000_000) return { type: 'call' };
  return { type: 'fold' };
}

/**
 * Auto-play every bot seat until the hand finishes.
 * Returns the finished state. Used for smoke tests and single-player mode.
 */
export function runOutBotHand(state: GameState, rng: () => number = Math.random): GameState {
  let s = state;
  let guard = 0;
  while (s.phase !== 'finished' && guard < 500) {
    const idx = s.currentTurnIndex;
    if (idx < 0) break;
    const p = s.players[idx];
    if (!p.isAI) break; // human seat — stop
    const action = decideBotAction(s, p.id, rng);
    s = applyAction(s, p.id, action);
    guard++;
  }
  return s;
}
