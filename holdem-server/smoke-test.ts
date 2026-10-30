/**
 * Smoke test: two clients join queue, wait for timeout, get matched into a
 * PokerRoom, bots fill remaining seats, and we observe a full hand play out.
 */
import { Client } from 'colyseus.js';

const ENDPOINT = 'ws://localhost:2567';

async function makePlayer(name: string) {
  const client = new Client(ENDPOINT);
  const queue = await client.joinOrCreate('queue', { name });
  console.log(`[${name}] joined queue`);

  queue.onMessage('queue-status', (msg) => {
    console.log(`[${name}] queue-status:`, msg);
  });

  queue.onMessage('match-start', async (msg) => {
    console.log(`[${name}] match-start -> room ${msg.roomId}`);
    await queue.leave();
    const poker = await client.joinById(msg.roomId);
    console.log(`[${name}] joined poker room, sessionId=${poker.sessionId}`);

    poker.onStateChange((state) => {
      const phase = state.phase;
      const board = (state.board as number[]).map((c) => `${Math.floor(c / 4)}${c % 4}`).join(' ');
      const pot = state.pot;
      const turn = state.currentTurnIndex;
      const winners = state.winners;
      const players = (state.players as any[]).map((p) => ({
        seat: p.seatIndex,
        name: p.name,
        isBot: p.isBot,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        hole: p.holeCards && p.holeCards.length ? p.holeCards.join(',') : '-',
      }));
      console.log(`[${name}] state: phase=${phase} pot=${pot} turn=${turn} board=[${board}]`);
      for (const pl of players) {
        console.log(`   seat${pl.seat} ${pl.name}${pl.isBot ? '(bot)' : ''} chips=${pl.chips} bet=${pl.bet}${pl.folded ? ' FOLD' : ''}${pl.allIn ? ' ALLIN' : ''} hole=[${pl.hole}]`);
      }
      if (winners && winners.length) {
        console.log(`[${name}] WINNERS:`, winners);
      }

      // Auto-act as the human player: if it's my turn, check if facing a bet.
      const mySeat = players.findIndex((p) => p.hole !== '-');
      if (turn === mySeat && mySeat >= 0) {
        setTimeout(() => {
          // If currentBet > my bet, call; otherwise check.
          if (state.currentBet > players[mySeat].bet) {
            poker.send('action', { type: 'call' });
          } else {
            poker.send('action', { type: 'check' });
          }
        }, 500);
      }
    });

    poker.onMessage('error', (msg) => console.log(`[${name}] ERROR:`, msg));

    // Auto-start hand after join (the queue room would normally trigger this).
    poker.send('start-hand', {});
  });

  return client;
}

async function main() {
  console.log('Starting two players...');
  const p1 = await makePlayer('Alice');
  const p2 = await makePlayer('Bob');

  // Run for 60 seconds to observe at least one full hand.
  setTimeout(() => {
    console.log('Done observing.');
    process.exit(0);
  }, 60000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
