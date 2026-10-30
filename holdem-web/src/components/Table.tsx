import { useEffect, useMemo, useState, useCallback } from 'react';
import type { TableState } from '../useColyseus';

const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_LABEL = ['♠', '♥', '♦', '♣'];
const SUIT_COLOR = ['#111', '#d33', '#d33', '#111'];

function cardId(c: number) {
  const rank = Math.floor(c / 4);
  const suit = c % 4;
  return { rank, suit, label: RANK_LABEL[rank], color: SUIT_COLOR[suit], suitLabel: SUIT_LABEL[suit] };
}

function PlayingCard({ c, faceDown, size = 'md' }: { c: number; faceDown?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  if (faceDown) return <div className={`card ${size} back`} />;
  const { label, suitLabel, color } = cardId(c);
  return (
    <div className={`card ${size}`} style={{ color }}>
      <div className="card-rank">{label}</div>
      <div className="card-suit">{suitLabel}</div>
    </div>
  );
}

// Positions for 6 seats around an oval (percent-based).
// seat 0 = bottom center (me), seats 1..5 arc around.
const SEAT_POS = [
  { left: '50%', bottom: '-28px', transform: 'translateX(-50%)' },   // 0 bottom (me)
  { left: '4%', bottom: '-10px' },                                      // 1 bottom-left
  { left: '0%', top: '38%' },                                           // 2 left-middle
  { left: '50%', top: '-28px', transform: 'translateX(-50%)' },         // 3 top
  { right: '0%', top: '38%' },                                          // 4 right-middle
  { right: '4%', bottom: '-10px' },                                     // 5 bottom-right
];

interface Props {
  state: TableState;
  onAction: (a: { type: string; to?: number }) => void;
}

export function Table({ state, onAction }: Props) {
  const mySeatIndex = useMemo(
    () => state.players.findIndex((p) => p.holeCards && p.holeCards.length === 2),
    [state],
  );
  const me = mySeatIndex >= 0 ? state.players[mySeatIndex] : null;
  const isMyTurn = state.currentTurnIndex === mySeatIndex && state.phase !== 'finished';
  const hasCards = !!me && me.holeCards.length === 2;

  // Peek state: hidden by default; reset on new hand or after any action.
  const [peeked, setPeeked] = useState(false);
  useEffect(() => {
    setPeeked(false);
  }, [state.handId]);

  const handleAction = useCallback((a: { type: string; to?: number }) => {
    setPeeked(false);
    onAction(a);
  }, [onAction]);

  return (
    <div className="screen table">
      <div className="table-oval">
        <div className="table-felt">
          <div className="community-row">
            {state.board.length === 0 && <div className="board-placeholder">公共牌</div>}
            {state.board.map((c, i) => (
              <PlayingCard key={i} c={c} size="md" />
            ))}
          </div>
          <div className="pot">底池 {state.pot}</div>
          {state.winners && state.winners.length > 0 && (
            <div className="winner-banner">
              {state.winners.map((w, i) => <span key={i}>赢家 +{w.amount}</span>)}
            </div>
          )}
        </div>

        {state.players.map((p) => {
          const pos = SEAT_POS[p.seatIndex] || SEAT_POS[0];
          return (
            <div
              key={p.seatIndex}
              className={`seat ${state.currentTurnIndex === p.seatIndex ? 'turn' : ''} ${p.folded ? 'folded' : ''}`}
              style={pos as React.CSSProperties}
            >
              {state.dealerIndex === p.seatIndex && <div className="dealer-btn">D</div>}
              <div className="seat-name">{p.name}</div>
              <div className="seat-chips">{p.chips}</div>
              {p.bet > 0 && <div className="seat-bet">下注 {p.bet}</div>}
              {p.allIn && <div className="seat-allin">ALL-IN</div>}
            </div>
          );
        })}
      </div>

      {hasCards && me!.holeCards.length === 2 && (
        <div className="my-hand">
          <button
            className={`hand-card ${peeked ? 'peeked' : ''}`}
            onClick={() => setPeeked((p) => !p)}
            aria-label="点击查看底牌"
          >
            {peeked ? <PlayingCard c={me!.holeCards[0]} size="lg" /> : <div className="card lg back" />}
          </button>
          <button
            className={`hand-card ${peeked ? 'peeked' : ''}`}
            onClick={() => setPeeked((p) => !p)}
            aria-label="点击查看底牌"
          >
            {peeked ? <PlayingCard c={me!.holeCards[1]} size="lg" /> : <div className="card lg back" />}
          </button>
          <div className="hand-tip">{peeked ? '点牌盖回' : '点牌看底牌'}</div>
        </div>
      )}

      <ActionPanel
        state={state}
        isMyTurn={isMyTurn}
        myStack={me?.chips ?? 0}
        myBet={me?.bet ?? 0}
        onAction={handleAction}
      />
    </div>
  );
}

function ActionPanel({
  state,
  isMyTurn,
  myStack,
  myBet,
  onAction,
}: {
  state: TableState;
  isMyTurn: boolean;
  myStack: number;
  myBet: number;
  onAction: (a: { type: string; to?: number }) => void;
}) {
  const [raiseTo, setRaiseTo] = useState(state.currentBet + state.minRaise);
  const [phase, setPhase] = useState<'idle' | 'raise'>('idle');

  if (!isMyTurn) {
    return (
      <div className="action-panel waiting">
        {state.phase === 'finished' ? '本局结束……' : '等待其他玩家……'}
      </div>
    );
  }

  const facingBet = state.currentBet > myBet;
  const minRaiseTo = state.currentBet + state.minRaise;
  const maxTo = myBet + myStack;
  const clampedTo = Math.max(minRaiseTo, Math.min(raiseTo, maxTo));

  const pot = state.pot;
  const presets = [
    { label: '½ 底池', value: Math.round(state.currentBet + pot / 2) },
    { label: '底池', value: state.currentBet + pot },
    { label: 'All-in', value: maxTo },
  ];

  return (
    <div className="action-panel">
      {phase === 'idle' ? (
        <div className="btn-row">
          <button className="btn" onClick={() => onAction({ type: 'fold' })}>弃牌</button>
          {facingBet ? (
            <>
              <button className="btn" onClick={() => onAction({ type: 'call' })}>跟注 {state.currentBet - myBet}</button>
              <button className="btn primary" onClick={() => setPhase('raise')}>加注</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => onAction({ type: 'check' })}>过牌</button>
              <button className="btn primary" onClick={() => setPhase('raise')}>加注</button>
            </>
          )}
          <button className="btn danger" onClick={() => onAction({ type: 'allin' })}>All-in</button>
        </div>
      ) : (
        <div className="raise-panel">
          <div className="raise-to">加注到 {clampedTo}</div>
          <input
            type="range"
            min={minRaiseTo}
            max={maxTo}
            value={clampedTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
          />
          <div className="btn-row">
            {presets.map((p) => (
              <button
                key={p.label}
                className="btn"
                onClick={() => setRaiseTo(Math.max(minRaiseTo, Math.min(p.value, maxTo)))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setPhase('idle')}>返回</button>
            <button className="btn primary" onClick={() => { onAction({ type: 'raise', to: clampedTo }); setPhase('idle'); }}>
              确认加注
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
