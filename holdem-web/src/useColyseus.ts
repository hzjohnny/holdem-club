import { Client, Room } from 'colyseus.js';
import { useCallback, useEffect, useRef, useState } from 'react';

// Match the PokerState schema from the server.
export interface PlayerView {
  seatIndex: number;
  name: string;
  isBot: boolean;
  chips: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  holeCards: number[];
  handRank: number;
}

export interface TableState {
  phase: string;
  handId: number;
  dealerIndex: number;
  currentTurnIndex: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  pot: number;
  board: number[];
  players: PlayerView[];
  winners: Array<{ playerId: string; amount: number }>;
}

export type Phase = 'home' | 'waiting' | 'table' | 'error';

const ENDPOINT =
  import.meta.env.MODE === 'production'
    ? window.location.origin.replace(/^http/, 'ws')
    : `ws://${window.location.hostname || 'localhost'}:2567`;

function toView(state: any): TableState {
  return {
    phase: state.phase,
    handId: state.handId,
    dealerIndex: state.dealerIndex,
    currentTurnIndex: state.currentTurnIndex,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    pot: state.pot,
    board: [...(state.board as number[])],
    players: (state.players as any[]).map((p) => ({
      seatIndex: p.seatIndex,
      name: p.name,
      isBot: p.isBot,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      connected: p.connected,
      holeCards: p.holeCards ? [...(p.holeCards as number[])] : [],
      handRank: p.handRank,
    })),
    winners: (state.winners as any[]).map((w) => ({
      playerId: w.playerId,
      amount: w.amount,
    })),
  };
}

export function useColyseus() {
  const [phase, setPhase] = useState<Phase>('home');
  const [table, setTable] = useState<TableState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<Client | null>(null);
  const queueRef = useRef<Room | null>(null);
  const tableRef = useRef<Room<any> | null>(null);

  const quickStart = useCallback(async () => {
    setError(null);
    setPhase('waiting');
    try {
      const client = new Client(ENDPOINT);
      clientRef.current = client;
      const queue = await client.joinOrCreate('queue', {});
      queueRef.current = queue;

      queue.onMessage('match-start', async (msg: { roomId: string }) => {
        try {
          await queue.leave();
          const room = await client.joinById(msg.roomId);
          tableRef.current = room;
          room.onStateChange((s) => setTable(toView(s)));
          setTable(toView(room.state));
          setPhase('table');
          // Trigger hand start.
          room.send('start-hand', {});
        } catch (e: any) {
          setError(e.message);
          setPhase('error');
        }
      });
    } catch (e: any) {
      setError(e.message);
      setPhase('error');
    }
  }, []);

  const sendAction = useCallback((action: { type: string; to?: number }) => {
    tableRef.current?.send('action', action);
  }, []);

  useEffect(() => {
    return () => {
      queueRef.current?.leave();
      tableRef.current?.leave();
    };
  }, []);

  return { phase, table, error, quickStart, sendAction };
}
