import { Room, Client, matchMaker } from '@colyseus/core';

interface QueueOptions {
  matchRoomName?: string;
  maxPlayers?: number;
  maxWaitingCycles?: number;     // how many 1s cycles to wait before incomplete start
  allowIncompleteGroups?: boolean;
  smallBlind?: number;
  bigBlind?: number;
  startingChips?: number;
}

/**
 * QueueRoom — matchmaking lobby.
 *
 * Behavior:
 *  - Clients join and wait.
 *  - Every 1s tick: waitingCycles++.
 *  - If waitingCycles >= maxWaitingCycles OR queue reaches maxPlayers,
 *    create a PokerRoom and transfer queued clients to it.
 *  - allowIncompleteGroups=true means we start even if queue < maxPlayers;
 *    the PokerRoom fills remaining seats with bots.
 */
export class QueueRoom extends Room {
  private opts: Required<QueueOptions> = {
    matchRoomName: 'poker',
    maxPlayers: 6,
    maxWaitingCycles: 5,
    allowIncompleteGroups: true,
    smallBlind: 5,
    bigBlind: 10,
    startingChips: 200,
  };
  private waitingCycles = 0;
  private queue: Client[] = [];
  private started = false;

  onCreate(options: QueueOptions) {
    this.opts = { ...this.opts, ...options };
    this.maxClients = 100;
    this.setSimulationInterval(() => this.tick(), 1000);
  }

  onJoin(client: Client) {
    this.queue.push(client);
    client.send('queue-status', { waiting: this.queue.length, cycles: this.waitingCycles });
  }

  onLeave(client: Client) {
    this.queue = this.queue.filter((c) => c !== client);
  }

  private tick() {
    if (this.started) return;
    this.waitingCycles++;

    const enough = this.queue.length >= this.opts.maxPlayers;
    const timeout =
      this.opts.allowIncompleteGroups &&
      this.waitingCycles >= this.opts.maxWaitingCycles &&
      this.queue.length >= 1;

    if (enough || timeout) {
      this.started = true;
      this.startPokerRoom();
    }
  }

  private async startPokerRoom() {
    const clients = [...this.queue];
    this.queue = [];

    // Create the poker room.
    const room = await matchMaker.createRoom('poker', {
      smallBlind: this.opts.smallBlind,
      bigBlind: this.opts.bigBlind,
      startingChips: this.opts.startingChips,
      maxPlayers: this.opts.maxPlayers,
    });

    // Tell each client to join the poker room. They will leave the queue room
    // and connect via client.joinById(room.roomId).
    for (const c of clients) {
      c.send('match-start', { roomId: room.roomId });
    }

    // Close the queue room shortly after.
    this.disconnect();
  }
}
