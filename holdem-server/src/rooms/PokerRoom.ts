import { Room, Client } from '@colyseus/core';
import {
  GameState,
  Player,
  createGame,
  applyAction,
  getLegalActions,
  startNextHand,
  mulberry32,
  type Action,
} from 'holdem-engine';
import { PokerState, PlayerState, SidePotState, WinnerState } from '../schema/PokerState.js';
import { BotController } from '../bots/BotController.js';

interface Seat {
  playerId: string;      // sessionId for humans, bot-N for bots
  name: string;
  isHuman: boolean;
  connected: boolean;
  sessionId?: string;     // for reconnection
  chips: number;
}

export interface PokerRoomOptions {
  smallBlind?: number;
  bigBlind?: number;
  startingChips?: number;
  maxPlayers?: number;
  botsToFill?: number;   // how many bots to fill immediately
}

const RECONNECT_GRACE_MS = 30_000;

export class PokerRoom extends Room<PokerState> {
  maxClients = 6;
  private seats: Seat[] = [];
  private engineState: GameState | null = null;
  private botController = new BotController(mulberry32((Date.now() % 2147483647) >>> 0));
  private opts: Required<PokerRoomOptions> = {
    smallBlind: 5,
    bigBlind: 10,
    startingChips: 200,
    maxPlayers: 6,
    botsToFill: 0,
  };
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private handStarted = false;

  onCreate(options: PokerRoomOptions) {
    this.opts = { ...this.opts, ...options };
    this.maxClients = this.opts.maxPlayers;
    this.setState(new PokerState());
    this.state.smallBlind = this.opts.smallBlind;
    this.state.bigBlind = this.opts.bigBlind;

    // Initialize empty seats.
    for (let i = 0; i < this.opts.maxPlayers; i++) {
      this.seats.push({
        playerId: '',
        name: '',
        isHuman: false,
        connected: false,
        chips: this.opts.startingChips,
      });
    }

    // Pre-fill bots if requested (for solo / quick-start mode).
    for (let i = 0; i < this.opts.botsToFill; i++) {
      this.fillSeatWithBot(i);
    }

    this.onMessage('action', (client, action: Action) => {
      this.handleAction(client, action);
    });

    this.onMessage('start-hand', () => {
      if (!this.handStarted) this.startHand();
    });
  }

  onJoin(client: Client, options: { name?: string } = {}) {
    // Try to reconnect to a previously held seat.
    const existingIdx = this.seats.findIndex(
      (s) => s.sessionId === client.sessionId && !s.isHuman,
    );
    if (existingIdx >= 0) {
      this.restoreSeat(existingIdx, client);
      return;
    }

    // Find an empty seat (not occupied by human).
    const emptyIdx = this.seats.findIndex((s) => !s.isHuman && s.playerId === '');
    if (emptyIdx < 0) {
      client.leave();
      return;
    }

    this.seats[emptyIdx] = {
      playerId: client.sessionId,
      name: options.name ?? `Player ${emptyIdx + 1}`,
      isHuman: true,
      connected: true,
      sessionId: client.sessionId,
      chips: this.opts.startingChips,
    };

    // Cancel any pending reconnection timer.
    const t = this.reconnectTimers.get(client.sessionId);
    if (t) { clearTimeout(t); this.reconnectTimers.delete(client.sessionId); }

    this.syncSchema();
  }

  async onLeave(client: Client, consented: boolean) {
    const idx = this.seats.findIndex((s) => s.sessionId === client.sessionId);
    if (idx < 0) return;
    const seat = this.seats[idx];
    seat.connected = false;

    if (consented) {
      // Player left for good — open the seat.
      this.openSeat(idx);
    } else {
      // Network drop — hold the seat for reconnection.
      const timer = setTimeout(() => {
        this.openSeat(idx);
      }, RECONNECT_GRACE_MS);
      this.reconnectTimers.set(client.sessionId, timer);
    }
    this.syncSchema();
  }

  dispose() {
    this.botController.clearAllTimers();
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
  }

  // -------------------------------------------------------------------------
  // Hand lifecycle
  // -------------------------------------------------------------------------

  private startHand() {
    if (this.handStarted) return;
    this.handStarted = true;

    // Fill any empty seat with a bot so the table can run.
    for (let i = 0; i < this.seats.length; i++) {
      if (!this.seats[i].isHuman && this.seats[i].playerId === '') {
        this.fillSeatWithBot(i);
      }
    }

    // Build playerId list in seat order.
    const playerIds = this.seats.map((s) => s.playerId);
    this.engineState = createGame(playerIds.length, this.opts.startingChips, {
      small: this.opts.smallBlind,
      big: this.opts.bigBlind,
    }, {
      playerIds,
    });

    // Restore chips from seats (in case they carried over from a previous hand).
    this.engineState.players.forEach((p: Player, i: number) => {
      p.chips = this.seats[i].chips;
    });

    this.syncSchema();
    this.maybeAdvanceBots();
  }

  private openSeat(idx: number) {
    const seat = this.seats[idx];
    if (seat.isHuman && this.botController.isBot(seat.playerId) === false) {
      // Was human — clear it.
    }
    // If it was a bot, remove from bot controller too.
    if (this.botController.isBot(seat.playerId)) {
      this.botController.removeBot(seat.playerId);
    }
    this.seats[idx] = {
      playerId: '',
      name: '',
      isHuman: false,
      connected: false,
      chips: this.opts.startingChips,
    };
  }

  private restoreSeat(idx: number, client: Client) {
    const seat = this.seats[idx];
    seat.connected = true;
    seat.sessionId = client.sessionId;
    seat.isHuman = true;
    seat.playerId = client.sessionId;
    const t = this.reconnectTimers.get(client.sessionId);
    if (t) { clearTimeout(t); this.reconnectTimers.delete(client.sessionId); }
    this.syncSchema();
  }

  private fillSeatWithBot(idx: number) {
    const bot = this.botController.assignBot();
    this.seats[idx] = {
      playerId: bot.playerId,
      name: bot.name,
      isHuman: false,
      connected: true,
      chips: this.opts.startingChips,
    };
  }

  // -------------------------------------------------------------------------
  // Action handling
  // -------------------------------------------------------------------------

  private handleAction(client: Client, action: Action) {
    if (!this.engineState) return;
    const seatIdx = this.seats.findIndex((s) => s.sessionId === client.sessionId);
    if (seatIdx < 0) return;
    const playerId = this.seats[seatIdx].playerId;

    // Validate it's this player's turn.
    const expected = this.engineState.players[this.engineState.currentTurnIndex]?.id;
    if (expected !== playerId) {
      client.send('error', { message: 'not your turn' });
      return;
    }

    const legal = getLegalActions(this.engineState, playerId);
    if (!this.isActionLegal(legal, action)) {
      client.send('error', { message: 'illegal action' });
      return;
    }

    try {
      this.engineState = applyAction(this.engineState, playerId, action);
    } catch (e) {
      client.send('error', { message: (e as Error).message });
      return;
    }

    this.syncSchema();
    this.afterEngineStep();
  }

  private isActionLegal(legal: ReturnType<typeof getLegalActions>, action: Action): boolean {
    switch (action.type) {
      case 'fold': return legal.canFold;
      case 'check': return legal.canCheck;
      case 'call': return legal.canCall;
      case 'allin': return legal.canAllIn;
      case 'raise': return legal.canRaise;
      default: return false;
    }
  }

  private afterEngineStep() {
    if (!this.engineState) return;
    // If hand finished, loop into next hand after a short pause.
    if (this.engineState.phase === 'finished') {
      // Carry chips back to seats.
      this.engineState.players.forEach((p: Player, i: number) => {
        this.seats[i].chips = p.chips;
      });
      setTimeout(() => {
        if (!this.engineState) return;
        this.engineState = startNextHand(this.engineState);
        this.syncSchema();
        this.maybeAdvanceBots();
      }, 3000);
      return;
    }
    this.maybeAdvanceBots();
  }

  private maybeAdvanceBots() {
    if (!this.engineState) return;
    this.botController.maybeScheduleTurn(
      this.engineState,
      (playerId, action) => {
        if (!this.engineState) return;
        try {
          this.engineState = applyAction(this.engineState, playerId, action);
        } catch (e) {
          this.broadcast('error', { message: (e as Error).message });
        }
        this.syncSchema();
        this.afterEngineStep();
      },
    );
  }

  // -------------------------------------------------------------------------
  // Schema sync
  // -------------------------------------------------------------------------

  private syncSchema() {
    try {
      this.syncSchemaInner();
    } catch (e) {
      console.error('[PokerRoom] syncSchema error:', e);
    }
  }

  private syncSchemaInner() {
    const s = this.state;
    if (!this.engineState) {
      s.phase = 'waiting';
      return;
    }
    const e = this.engineState;
    s.phase = e.phase;
    s.handId = e.handId;
    s.dealerIndex = e.dealerIndex;
    s.currentTurnIndex = e.currentTurnIndex;
    s.currentBet = e.currentBet;
    s.minRaise = e.minRaise;
    s.pot = e.pot;

    // Mutate arrays in place (Colyseus schema diffs against existing content).
    s.board.clear();
    for (const c of e.board) s.board.push(c);

    s.players.clear();
    e.players.forEach((p: Player, i: number) => {
      const ps = new PlayerState();
      ps.playerId = p.id;
      ps.name = this.seats[i]?.name ?? p.id;
      ps.seatIndex = i;
      ps.chips = p.chips;
      ps.bet = p.bet;
      ps.totalBet = p.totalBet;
      ps.folded = p.folded;
      ps.allIn = p.allIn;
      ps.hasActed = p.hasActed;
      ps.isBot = this.botController.isBot(p.id);
      ps.connected = this.seats[i]?.connected ?? false;
      ps.handRank = p.handRank ?? -1;
      if (p.holeCards) {
        ps.holeCards.push(p.holeCards[0]);
        ps.holeCards.push(p.holeCards[1]);
      }
      s.players.push(ps);
    });

    s.sidePots.clear();
    for (const sp of e.sidePots) {
      const sps = new SidePotState();
      sps.amount = sp.amount;
      for (const id of sp.eligiblePlayerIds) sps.eligiblePlayerIds.push(id);
      s.sidePots.push(sps);
    }

    s.winners.clear();
    if (e.winners) {
      for (const w of e.winners) {
        const ws = new WinnerState();
        ws.playerId = w.playerId;
        ws.amount = w.amount;
        ws.handRank = w.handRank ?? -1;
        s.winners.push(ws);
      }
    }
  }
}
