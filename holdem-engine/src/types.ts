/**
 * Core type definitions for the Texas Hold'em engine.
 * This module has zero runtime dependencies and runs in Node and browsers.
 */

export type Phase =
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'finished';

export interface Player {
  id: string;
  /** Stack of chips still available to bet. */
  chips: number;
  /** Two hole cards as numeric card ids (0..51). Null until dealt. */
  holeCards: [number, number] | null;
  /** Amount committed to the *current* betting round. */
  bet: number;
  /** Total amount committed over the whole hand (drives side-pot layering). */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** Whether this player has acted since the last valid raise. */
  hasActed: boolean;
  /** Cached evaluated hand strength at showdown (read-only for UI). */
  handRank?: number;
  isAI: boolean;
}

export interface SidePot {
  amount: number;
  /** Player ids eligible to win this pot (non-folded and paid into this layer). */
  eligiblePlayerIds: string[];
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export interface LegalActions {
  canCheck: boolean;
  canCall: boolean;
  /** Amount required to call (already reduced by current bet). */
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  canFold: boolean;
  canAllIn: boolean;
}

export interface Winner {
  playerId: string;
  amount: number;
  handRank?: number;
}

export interface GameState {
  handId: number;
  phase: Phase;
  players: Player[];
  dealerIndex: number;
  /** Index of the player whose turn it is, -1 when no one acts. */
  currentTurnIndex: number;
  /** Remaining cards in the deck (top of array = next card to pop). */
  deck: number[];
  board: number[];
  /** Bet amount a player must match to continue, this round. */
  currentBet: number;
  /** Minimum increment for a valid raise. */
  minRaise: number;
  blinds: { small: number; big: number };
  sidePots: SidePot[];
  /** Total chips in play (sum of sidePots). */
  pot: number;
  winners?: Winner[];
}

export interface CreateGameOptions {
  rng?: () => number;
  playerIds?: string[];
  dealerIndex?: number;
  /** Test hook: pass a pre-ordered deck (top = last element, like a stack). */
  deck?: number[];
}
