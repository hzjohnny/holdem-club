/**
 * BotController — fills empty seats with bots and drives their turns.
 *
 * A bot is just a seat occupant with a personality and a randomized delay.
 * The PokerRoom owns the engine state; this controller reads currentTurnIndex
 * and, when it points at a bot seat, schedules a delayed action.
 */

import type { GameState, Action } from 'holdem-engine';
import {
  BotPersonality,
  decideBotAction,
  randomPersonality,
} from './personalities.js';

export interface BotSeat {
  playerId: string;
  personality: BotPersonality;
  name: string;
  delayMs: number;
}

const BOT_NAMES = [
  'Nova', 'Echo', 'Pixel', 'Rogue', 'Sage', 'Titan', 'Vex', 'Wren',
];

export class BotController {
  private bots = new Map<string, BotSeat>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private botCounter = 0;

  constructor(private rng: () => number = Math.random) {}

  /** Assign a bot to an empty seat. Returns the bot's playerId. */
  assignBot(): BotSeat {
    const id = `bot-${++this.botCounter}`;
    const personality = randomPersonality(this.rng);
    const delayMs = 800 + Math.floor(this.rng() * 1200); // 800..2000ms
    const name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)];
    const seat: BotSeat = { playerId: id, personality, name, delayMs };
    this.bots.set(id, seat);
    return seat;
  }

  isBot(playerId: string): boolean {
    return this.bots.has(playerId);
  }

  getBot(playerId: string): BotSeat | undefined {
    return this.bots.get(playerId);
  }

  removeBot(playerId: string): void {
    this.clearTimer(playerId);
    this.bots.delete(playerId);
  }

  clearAllTimers(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * If it's a bot's turn, schedule an action after its simulated thinking delay.
   * The room passes a callback `onAction(playerId, action)` that mutates engine + syncs schema.
   */
  maybeScheduleTurn(
    state: GameState,
    onAction: (playerId: string, action: Action) => void,
  ): void {
    if (state.phase === 'finished' || state.currentTurnIndex < 0) return;
    const player = state.players[state.currentTurnIndex];
    if (!player || !this.bots.has(player.id)) return;

    const bot = this.bots.get(player.id)!;
    this.clearTimer(player.id);
    const timer = setTimeout(() => {
      this.timers.delete(player.id);
      const action = decideBotAction(state, player.id, bot.personality, this.rng);
      onAction(player.id, action);
    }, bot.delayMs);
    this.timers.set(player.id, timer);
  }

  private clearTimer(playerId: string): void {
    const t = this.timers.get(playerId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(playerId);
    }
  }
}
