/**
 * Headless No-Limit Texas Hold'em engine.
 *
 * - All decisions (dealing, legality, side-pot, showdown) are server-side.
 * - The client only sends intents; this module enforces rules.
 * - `snapshotFor(state, viewerId)` produces a per-player view that hides
 *   other players' hole cards — use this before sending state over the wire.
 *
 * Pure TS, no network / DOM / Node-only API. Runs in Node and browsers.
 */

import { makeDeck, shuffle, mulberry32 } from './card.js';
import { evaluate7 } from './handRanker.js';
import { buildSidePots, totalPot } from './pot.js';
import type {
  Action,
  CreateGameOptions,
  GameState,
  LegalActions,
  Player,
} from './types.js';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

let handCounter = 0;

export function createGame(
  playerCount: number,
  startingChips: number,
  blinds: { small: number; big: number },
  options: CreateGameOptions = {},
): GameState {
  if (playerCount < 2 || playerCount > 6) {
    throw new Error(`playerCount must be 2..6, got ${playerCount}`);
  }
  if (blinds.small <= 0 || blinds.big <= 0 || blinds.big < blinds.small) {
    throw new Error('invalid blinds');
  }
  const rng = options.rng ?? mulberry32((Date.now() % 2147483647) >>> 0);
  const ids =
    options.playerIds ??
    Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const seedDealer = options.dealerIndex ?? 0;
  const deckOverride = options.deck;

  const players: Player[] = ids.slice(0, playerCount).map((id) => ({
    id,
    chips: startingChips,
    holeCards: null,
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    isAI: false,
  }));

  handCounter++;
  const state: GameState = {
    handId: handCounter,
    phase: 'preflop',
    players,
    dealerIndex: seedDealer,
    currentTurnIndex: -1,
    deck: [],
    board: [],
    currentBet: blinds.big,
    minRaise: blinds.big,
    blinds,
    sidePots: [],
    pot: 0,
  };

  dealNewHand(state, rng, deckOverride);
  return state;
}

/**
 * Start the next hand. Dealer button advances; players keep their stacks.
 * Use this to loop hands in a long-running session (bot vs bot, etc.).
 */
export function startNextHand(state: GameState, rng: () => number = Math.random): GameState {
  const s = cloneState(state);
  s.dealerIndex = (s.dealerIndex + 1) % s.players.length;
  handCounter++;
  s.handId = handCounter;
  dealNewHand(s, rng);
  return s;
}

function dealNewHand(state: GameState, rng: () => number, deckOverride?: number[]): void {
  for (const p of state.players) {
    p.holeCards = null;
    p.bet = 0;
    p.totalBet = 0;
    p.folded = false;
    p.allIn = false;
    p.hasActed = false;
    delete p.handRank;
  }
  state.board = [];
  state.sidePots = [];
  state.pot = 0;
  state.winners = undefined;
  state.phase = 'preflop';

  state.deck = deckOverride ? [...deckOverride] : shuffle(makeDeck(), rng);

  const n = state.players.length;
  const { sbIdx, bbIdx, firstToActPreflop } = blindPositions(state.dealerIndex, n);

  postBet(state, sbIdx, state.blinds.small);
  postBet(state, bbIdx, state.blinds.big);

  state.currentBet = state.blinds.big;
  state.minRaise = state.blinds.big;

  // Deal two hole cards to every player, starting left of dealer (standard order).
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      const idx = (state.dealerIndex + 1 + i) % n;
      const c = state.deck.pop()!;
      if (!state.players[idx].holeCards) state.players[idx].holeCards = [c, c];
      else state.players[idx].holeCards[1] = c;
    }
  }

  state.currentTurnIndex = firstToActPreflop;
  advanceTurn(state);
}

function blindPositions(dealerIndex: number, n: number): {
  sbIdx: number;
  bbIdx: number;
  firstToActPreflop: number;
} {
  if (n === 2) {
    // Heads-up: dealer is the small blind, other is big blind.
    return {
      sbIdx: dealerIndex,
      bbIdx: (dealerIndex + 1) % n,
      firstToActPreflop: (dealerIndex + 1) % n, // BB acts first preflop
    };
  }
  const sbIdx = (dealerIndex + 1) % n;
  const bbIdx = (dealerIndex + 2) % n;
  return {
    sbIdx,
    bbIdx,
    firstToActPreflop: (bbIdx + 1) % n,
  };
}

// ---------------------------------------------------------------------------
// Betting primitives
// ---------------------------------------------------------------------------

function postBet(state: GameState, playerIdx: number, amount: number): void {
  const p = state.players[playerIdx];
  const pay = Math.min(amount, p.chips);
  p.chips -= pay;
  p.bet += pay;
  p.totalBet += pay;
  if (p.chips === 0) p.allIn = true;
}

function isRoundComplete(state: GameState): boolean {
  for (const p of state.players) {
    if (p.folded || p.allIn) continue;
    if (!p.hasActed) return false;
    if (p.bet !== state.currentBet) return false;
  }
  return true;
}

function advanceTurn(state: GameState): void {
  if (isRoundComplete(state)) {
    endBettingRound(state);
    return;
  }

  const n = state.players.length;
  // Start from currentTurnIndex and walk forward; check the current player first
  // (they may already be the one who needs to act).
  for (let step = 0; step < n; step++) {
    const idx = (state.currentTurnIndex + step) % n;
    const p = state.players[idx];
    if (p.folded || p.allIn) continue;
    if (p.bet === state.currentBet && p.hasActed) continue;
    state.currentTurnIndex = idx;
    return;
  }
  endBettingRound(state);
}

function endBettingRound(state: GameState): void {
  // Reset per-round state.
  for (const p of state.players) {
    p.bet = 0;
    p.hasActed = false;
  }
  state.currentBet = 0;
  state.minRaise = state.blinds.big;

  state.sidePots = buildSidePots(state.players);
  state.pot = totalPot(state.sidePots);

  const remaining = state.players.filter((p) => !p.folded);
  if (remaining.length === 1) {
    awardPots(state);
    return;
  }

  // Burn one card then deal next street.
  state.deck.pop(); // burn

  switch (state.phase) {
    case 'preflop':
      state.phase = 'flop';
      state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
      break;
    case 'flop':
      state.phase = 'turn';
      state.board.push(state.deck.pop()!);
      break;
    case 'turn':
      state.phase = 'river';
      state.board.push(state.deck.pop()!);
      break;
    case 'river':
      awardPots(state);
      return;
    default:
      return;
  }

  // First to act post-flop: SB (or dealer in heads-up).
  const n = state.players.length;
  const first = n === 2 ? state.dealerIndex : (state.dealerIndex + 1) % n;
  state.currentTurnIndex = first;
  advanceTurn(state);
}

function awardPots(state: GameState): void {
  state.sidePots = buildSidePots(state.players);
  state.pot = totalPot(state.sidePots);
  state.winners = [];

  const remaining = state.players.filter((p) => !p.folded);

  // Everyone but one folded — award the whole pot without showing down.
  if (remaining.length === 1) {
    const w = remaining[0];
    w.chips += state.pot;
    state.winners.push({ playerId: w.id, amount: state.pot });
    state.phase = 'finished';
    return;
  }

  // Evaluate every remaining hand.
  for (const p of remaining) {
    if (p.holeCards) {
      p.handRank = evaluate7([p.holeCards[0], p.holeCards[1], ...state.board]);
    }
  }

  for (const pot of state.sidePots) {
    const contenders = remaining.filter((p) => pot.eligiblePlayerIds.includes(p.id));
    if (contenders.length === 0) continue;

    let best = -1;
    for (const c of contenders) best = Math.max(best, c.handRank ?? -1);
    const winners = contenders.filter((c) => (c.handRank ?? -1) === best);

    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;

    winners.forEach((w, i) => {
      const amt = share + (i === 0 ? remainder : 0);
      w.chips += amt;
      state.winners!.push({ playerId: w.id, amount: amt, handRank: w.handRank });
    });
  }

  state.phase = 'finished';
  state.currentTurnIndex = -1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getLegalActions(state: GameState, playerId: string): LegalActions {
  const idx = state.players.findIndex((p) => p.id === playerId);
  const empty: LegalActions = {
    canCheck: false,
    canCall: false,
    callAmount: 0,
    canRaise: false,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    canFold: false,
    canAllIn: false,
  };
  if (idx < 0) return empty;
  const p = state.players[idx];
  if (state.currentTurnIndex !== idx || p.folded || p.allIn) return empty;

  const diff = state.currentBet - p.bet;
  const canCheck = diff <= 0;
  const canCall = p.chips > 0 && diff > 0;
  const callAmount = Math.min(diff, p.chips);

  // A valid raise must reach at least currentBet + minRaise.
  // Player can do that only if their remaining stack supports it.
  const minRaiseTo = state.currentBet + state.minRaise;
  const maxRaiseTo = p.bet + p.chips;
  const canRaise = maxRaiseTo >= minRaiseTo;

  return {
    canCheck,
    canCall,
    callAmount,
    canRaise,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
    canFold: true,
    canAllIn: p.chips > 0,
  };
}

export function applyAction(state: GameState, playerId: string, action: Action): GameState {
  const s = cloneState(state);
  const idx = s.players.findIndex((p) => p.id === playerId);
  if (idx < 0) throw new Error(`unknown player ${playerId}`);
  if (s.currentTurnIndex !== idx) throw new Error(`not ${playerId}'s turn`);

  const p = s.players[idx];
  if (p.folded || p.allIn) throw new Error(`${playerId} cannot act`);

  switch (action.type) {
    case 'fold': {
      p.folded = true;
      p.hasActed = true;
      break;
    }
    case 'check': {
      if (s.currentBet - p.bet > 0) throw new Error('cannot check while facing a bet');
      p.hasActed = true;
      break;
    }
    case 'call': {
      const diff = s.currentBet - p.bet;
      if (diff <= 0) throw new Error('nothing to call');
      postBet(s, idx, diff);
      p.hasActed = true;
      break;
    }
    case 'raise': {
      const legal = getLegalActions(s, playerId);
      if (!legal.canRaise) throw new Error('cannot raise');
      let to = action.to;
      if (to < legal.minRaiseTo) to = legal.minRaiseTo;
      if (to > legal.maxRaiseTo) to = legal.maxRaiseTo;

      const increment = to - s.currentBet;
      postBet(s, idx, to - p.bet);
      p.hasActed = true;

      if (p.allIn && increment < s.minRaise) {
        // Short all-in: raises currentBet but does NOT reopen betting.
        // Players who already acted keep hasActed = true; those who haven't still get a turn.
        if (to > s.currentBet) s.currentBet = to;
      } else {
        // Valid raise: update minRaise, reopen betting for everyone else.
        s.currentBet = to;
        s.minRaise = increment;
        for (let i = 0; i < s.players.length; i++) {
          if (i === idx) continue;
          const other = s.players[i];
          if (!other.folded && !other.allIn) other.hasActed = false;
        }
      }
      break;
    }
    case 'allin': {
      const to = p.bet + p.chips;
      const increment = to - s.currentBet;
      postBet(s, idx, p.chips);
      p.hasActed = true;

      if (to > s.currentBet) {
        if (increment >= s.minRaise) {
          s.currentBet = to;
          s.minRaise = increment;
          for (let i = 0; i < s.players.length; i++) {
            if (i === idx) continue;
            const other = s.players[i];
            if (!other.folded && !other.allIn) other.hasActed = false;
          }
        } else {
          // Short all-in raise, no reopen.
          s.currentBet = to;
        }
      }
      break;
    }
  }

  advanceTurn(s);
  return s;
}

/**
 * Produce a private snapshot for `viewerId`.
 * Other players' holeCards are stripped, so this is safe to send over the wire
 * even when those players are AI (their hole cards never leak to humans).
 */
export function snapshotFor(state: GameState, viewerId: string): GameState {
  const s = cloneState(state);
  for (const p of s.players) {
    if (p.id !== viewerId) p.holeCards = null;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, holeCards: p.holeCards ? ([...p.holeCards] as [number, number]) : null })),
    deck: [...state.deck],
    board: [...state.board],
    sidePots: state.sidePots.map((sp) => ({ ...sp, eligiblePlayerIds: [...sp.eligiblePlayerIds] })),
    winners: state.winners ? state.winners.map((w) => ({ ...w })) : undefined,
  };
}
