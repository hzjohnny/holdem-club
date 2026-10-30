import { Schema, type, filter, ArraySchema } from '@colyseus/schema';

/**
 * Per-player state. holeCards is filtered so only the owning client receives it.
 * Bots' hole cards therefore never leak to humans before showdown.
 */
export class PlayerState extends Schema {
  @type('string') playerId: string = '';
  @type('string') name: string = '';
  @type('number') seatIndex: number = -1;
  @type('number') chips: number = 0;
  @type('number') bet: number = 0;
  @type('number') totalBet: number = 0;
  @type('boolean') folded: boolean = false;
  @type('boolean') allIn: boolean = false;
  @type('boolean') hasActed: boolean = false;
  @type('boolean') isBot: boolean = false;
  @type('boolean') connected: boolean = true;
  @type('number') handRank: number = -1;
  /** Populated only for the client who owns this seat. */
  @filter(holeCardsFilter)
  @type(['number']) holeCards = new ArraySchema<number>();
}

function holeCardsFilter(
  this: PlayerState,
  client: { sessionId: string },
): boolean {
  return client.sessionId === this.playerId;
}

export class SidePotState extends Schema {
  @type('number') amount: number = 0;
  @type(['string']) eligiblePlayerIds = new ArraySchema<string>();
}

export class WinnerState extends Schema {
  @type('string') playerId: string = '';
  @type('number') amount: number = 0;
  @type('number') handRank: number = -1;
}

export class PokerState extends Schema {
  @type('string') phase: string = 'waiting';
  @type('number') handId: number = 0;
  @type('number') dealerIndex: number = -1;
  @type('number') currentTurnIndex: number = -1;
  @type('number') currentBet: number = 0;
  @type('number') minRaise: number = 0;
  @type('number') smallBlind: number = 0;
  @type('number') bigBlind: number = 0;
  @type('number') pot: number = 0;
  @type(['number']) board = new ArraySchema<number>();
  @type([PlayerState]) players = new ArraySchema<PlayerState>();
  @type([SidePotState]) sidePots = new ArraySchema<SidePotState>();
  @type([WinnerState]) winners = new ArraySchema<WinnerState>();
}
