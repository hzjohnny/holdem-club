import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  getLegalActions,
  snapshotFor,
  evaluate5,
  evaluate7,
  categoryName,
  makeCard,
  mulberry32,
  runOutBotHand,
} from '../src/index';

// rank: 0=2, 1=3, ..., 12=A ; suit: 0=♠ 1=♥ 2=♦ 3=♣
const C = (r: number, s: number) => makeCard(r, s);

/** Build a deck stack from a deal-ordered list. The first card listed is dealt first. */
function deckFrom(...cards: number[]): number[] {
  return [...cards].reverse();
}

// ---------------------------------------------------------------------------
// Hand evaluator
// ---------------------------------------------------------------------------
describe('evaluate5 / evaluate7 — hand ranking', () => {
  it('ranks categories correctly: SF > quads > full house > flush > straight > trips > two pair > pair > high', () => {
    const straightFlush = evaluate5([C(12, 0), C(11, 0), C(10, 0), C(9, 0), C(8, 0)]);
    const quads = evaluate5([C(12, 0), C(12, 1), C(12, 2), C(12, 3), C(5, 0)]);
    const fullHouse = evaluate5([C(12, 0), C(12, 1), C(12, 2), C(5, 0), C(5, 1)]);
    const flush = evaluate5([C(12, 0), C(9, 0), C(6, 0), C(3, 0), C(2, 0)]);
    const straight = evaluate5([C(12, 0), C(11, 1), C(10, 2), C(9, 3), C(8, 0)]);
    const trips = evaluate5([C(12, 0), C(12, 1), C(12, 2), C(5, 0), C(3, 1)]);
    const twoPair = evaluate5([C(12, 0), C(12, 1), C(5, 0), C(5, 1), C(3, 2)]);
    const pair = evaluate5([C(12, 0), C(12, 1), C(5, 0), C(3, 1), C(2, 2)]);
    const high = evaluate5([C(12, 0), C(9, 1), C(6, 2), C(3, 3), C(2, 0)]);

    expect(straightFlush).toBeGreaterThan(quads);
    expect(quads).toBeGreaterThan(fullHouse);
    expect(fullHouse).toBeGreaterThan(flush);
    expect(flush).toBeGreaterThan(straight);
    expect(straight).toBeGreaterThan(trips);
    expect(trips).toBeGreaterThan(twoPair);
    expect(twoPair).toBeGreaterThan(pair);
    expect(pair).toBeGreaterThan(high);
  });

  it('wheel A-2-3-4-5 ranks as 5-high straight (lower than 6-high)', () => {
    const wheel = evaluate5([C(12, 0), C(0, 1), C(1, 2), C(2, 3), C(3, 0)]);
    const sixHigh = evaluate5([C(4, 0), C(3, 1), C(2, 2), C(1, 3), C(0, 0)]);
    expect(categoryName(wheel)).toBe('Straight');
    expect(sixHigh).toBeGreaterThan(wheel);
  });

  it('kickers break ties', () => {
    const pairAHighKicker = evaluate5([C(12, 0), C(12, 1), C(11, 0), C(3, 1), C(2, 2)]);
    const pairAHighKickerLower = evaluate5([C(12, 0), C(12, 1), C(10, 0), C(3, 1), C(2, 2)]);
    expect(pairAHighKicker).toBeGreaterThan(pairAHighKickerLower);
  });

  it('evaluate7 picks the best 5 out of 7', () => {
    const seven = evaluate7([
      C(12, 0), C(12, 1),
      C(11, 0), C(9, 0), C(6, 0), C(3, 0), C(2, 3),
    ]);
    expect(categoryName(seven)).toBe('Flush');
  });
});

// ---------------------------------------------------------------------------
// Heads-up all-in
// ---------------------------------------------------------------------------
describe('side pots — heads-up all-in', () => {
  it('single pot when two players go all-in; AA beats KK', () => {
    // Heads-up: dealer=p0 is SB, p1 is BB. BB acts first preflop.
    // Deal order (n=2, dealer=0): p1 hole1, p0 hole1, p1 hole2, p0 hole2, burn, flop.
    const deck = deckFrom(
      C(11, 0), // p1 hole1 K♠
      C(12, 0), // p0 hole1 A♠
      C(11, 1), // p1 hole2 K♥
      C(12, 1), // p0 hole2 A♥
      C(8, 2), // burn
      C(10, 0), // Q♠
      C(9, 0), // J♠
      C(2, 3), // 2♣
    );
    const s0 = createGame(2, 100, { small: 5, big: 10 }, { deck, playerIds: ['p0', 'p1'] });
    let s = s0;
    s = applyAction(s, 'p1', { type: 'allin' }); // BB shoves 100
    s = applyAction(s, 'p0', { type: 'allin' }); // SB calls/shoves 100

    expect(s.phase).toBe('finished');
    const p0 = s.players.find((p) => p.id === 'p0')!;
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p0.chips).toBe(200);
    expect(p1.chips).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-way side pots
// ---------------------------------------------------------------------------
describe('side pots — multi-way all-in layering', () => {
  it('splits main pot and side pot when three players all-in for different stacks', () => {
    // n=3, dealer=p0. p0 short stack 50, p1/p2 full 200.
    // Sequence: p0 all-in 50, p1 all-in 200 (raise), p2 calls 200.
    const s0 = createGame(3, 200, { small: 5, big: 10 }, { playerIds: ['p0', 'p1', 'p2'] });
    s0.players[0].chips = 50; // shrink p0

    let s = s0;
    s = applyAction(s, 'p0', { type: 'allin' });   // p0 all-in for 50
    s = applyAction(s, 'p1', { type: 'allin' });   // p1 all-in to 200
    s = applyAction(s, 'p2', { type: 'allin' });   // p2 calls to 200

    expect(s.phase).toBe('finished');
    expect(s.sidePots.length).toBe(2);
    // Main layer 0..50: 3 players * 50 = 150
    expect(s.sidePots[0].amount).toBe(150);
    expect([...s.sidePots[0].eligiblePlayerIds].sort()).toEqual(['p0', 'p1', 'p2'].sort());
    // Side layer 50..200: 2 players * 150 = 300
    expect(s.sidePots[1].amount).toBe(300);
    expect([...s.sidePots[1].eligiblePlayerIds].sort()).toEqual(['p1', 'p2'].sort());
  });
});

// ---------------------------------------------------------------------------
// Min-raise legality
// ---------------------------------------------------------------------------
describe('min-raise rules', () => {
  it('clamps a raise below minRaise to minRaiseTo, not to zero', () => {
    const s0 = createGame(2, 1000, { small: 5, big: 10 }, { playerIds: ['p0', 'p1'] });
    let s = applyAction(s0, 'p1', { type: 'check' }); // BB checks
    s = applyAction(s, 'p0', { type: 'raise', to: 14 }); // SB tries to raise to 14 (< min 20)
    const p0 = s.players.find((p) => p.id === 'p0')!;
    expect(p0.bet).toBe(20);
    expect(s.currentBet).toBe(20);
  });

  it('short all-in (< minRaise) does not update minRaise and round still completes', () => {
    // n=3. p0 raise to 40 (increment=30, minRaise=30).
    // p1 calls to 40. p2 (BB, chips=50) short all-in to 50 (increment=10 < 30).
    const s0 = createGame(3, 1000, { small: 5, big: 10 }, { playerIds: ['p0', 'p1', 'p2'] });
    s0.players[2].chips = 50;
    let s = s0;
    s = applyAction(s, 'p0', { type: 'raise', to: 40 });
    expect(s.minRaise).toBe(30);
    s = applyAction(s, 'p1', { type: 'call' });
    s = applyAction(s, 'p2', { type: 'allin' }); // p2 goes to 60 total (10 BB + 50 stack)
    // minRaise must remain 30, not 20.
    expect(s.minRaise).toBe(30);
    // currentBet updated to 60.
    expect(s.currentBet).toBe(60);
    // p0 and p1 still need to call the extra 10.
    expect(s.currentTurnIndex).toBe(0); // p0 next
    s = applyAction(s, 'p0', { type: 'call' });
    expect(s.currentTurnIndex).toBe(1); // p1 next
    s = applyAction(s, 'p1', { type: 'call' });
    // Round complete, move to flop.
    expect(s.phase).toBe('flop');
  });
});

// ---------------------------------------------------------------------------
// Showdown hand comparison
// ---------------------------------------------------------------------------
describe('showdown', () => {
  it('pair of aces beats pair of kings; correct pot award', () => {
    const deck = deckFrom(
      C(11, 0), // p1 K♠
      C(12, 0), // p0 A♠
      C(11, 1), // p1 K♥
      C(12, 1), // p0 A♥
      C(8, 2), // burn
      C(10, 0), C(9, 0), C(2, 3), // Q♠ J♠ 2♣
    );
    const s0 = createGame(2, 100, { small: 5, big: 10 }, { deck, playerIds: ['p0', 'p1'] });
    let s = s0;
    s = applyAction(s, 'p1', { type: 'check' }); // BB checks
    s = applyAction(s, 'p0', { type: 'call' }); // SB completes
    // Flop, turn, river — both check.
    s = applyAction(s, 'p0', { type: 'check' });
    s = applyAction(s, 'p1', { type: 'check' });
    s = applyAction(s, 'p0', { type: 'check' });
    s = applyAction(s, 'p1', { type: 'check' });
    s = applyAction(s, 'p0', { type: 'check' });
    s = applyAction(s, 'p1', { type: 'check' });

    expect(s.phase).toBe('finished');
    const p0 = s.players.find((p) => p.id === 'p0')!;
    const p1 = s.players.find((p) => p.id === 'p1')!;
    // p0 invested 5(SB)+5=10, p1 invested 10(BB). Pot=20. p0 wins -> 100-10+20=110.
    expect(p0.chips).toBe(110);
    expect(p1.chips).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// snapshotFor — privacy
// ---------------------------------------------------------------------------
describe('snapshotFor', () => {
  it('viewer sees own hole cards but other players holeCards are null', () => {
    const s = createGame(3, 100, { small: 5, big: 10 }, { playerIds: ['p0', 'p1', 'p2'] });
    const asP0 = snapshotFor(s, 'p0');
    const p0view = asP0.players.find((p) => p.id === 'p0')!;
    const p1view = asP0.players.find((p) => p.id === 'p1')!;
    const p2view = asP0.players.find((p) => p.id === 'p2')!;

    expect(p0view.holeCards).not.toBeNull();
    expect(p0view.holeCards!.length).toBe(2);
    expect(p1view.holeCards).toBeNull();
    expect(p2view.holeCards).toBeNull();
    expect(s.players[1].holeCards).not.toBeNull();
  });

  it('different viewers get different snapshots', () => {
    const s = createGame(2, 100, { small: 5, big: 10 }, { playerIds: ['p0', 'p1'] });
    const snap0 = snapshotFor(s, 'p0');
    const snap1 = snapshotFor(s, 'p1');
    expect(snap0.players[0].holeCards).toEqual(s.players[0].holeCards);
    expect(snap1.players[1].holeCards).toEqual(s.players[1].holeCards);
    expect(snap0.players[1].holeCards).toBeNull();
    expect(snap1.players[0].holeCards).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Smoke: bot vs bot
// ---------------------------------------------------------------------------
describe('bot vs bot', () => {
  it('runs a full hand to showdown without throwing', () => {
    const s = createGame(4, 200, { small: 5, big: 10 }, {
      playerIds: ['b0', 'b1', 'b2', 'b3'],
      rng: mulberry32(42),
    });
    for (const p of s.players) p.isAI = true;
    const final = runOutBotHand(s, mulberry32(7));
    expect(final.phase).toBe('finished');
    expect(final.winners && final.winners.length).toBeGreaterThan(0);
  });
});
