// lib/tournaments.ts
// Gaming arena: tournaments with brackets, seeding, and prize pools

import { prisma } from "./prisma";
import { postTournamentResult } from "./onchain";

/**
 * Generate a single-elimination bracket from entries
 */
export async function generateBracket(tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { entries: { include: { agent: true } } },
  });

  if (!tournament) throw new Error("Tournament not found");

  const entries = tournament.entries.filter((e) => !e.eliminated);
  
  // Seed by reputation (highest rep = #1 seed)
  const seeded = entries
    .sort((a, b) => b.agent.reputation - a.agent.reputation)
    .map((e, i) => ({ ...e, seed: i + 1 }));

  // Update seeds
  for (const entry of seeded) {
    await prisma.tournamentEntry.update({
      where: { id: entry.id },
      data: { seed: entry.seed },
    });
  }

  // Pad to next power of 2
  let bracketSize = 1;
  while (bracketSize < seeded.length) bracketSize *= 2;

  const totalRounds = Math.log2(bracketSize);

  // Create first-round matches with standard tournament seeding
  const matchups = createSeededMatchups(seeded.length, bracketSize);
  const matches: any[] = [];

  for (let i = 0; i < matchups.length; i++) {
    const [seedA, seedB] = matchups[i];
    const agentA = seedA <= seeded.length ? seeded[seedA - 1] : null;
    const agentB = seedB <= seeded.length ? seeded[seedB - 1] : null;

    const isBye = !agentA || !agentB;

    matches.push(
      await prisma.bracketMatch.create({
        data: {
          tournamentId,
          bracketRound: 1,
          matchNumber: i + 1,
          agentAId: agentA?.agentId || null,
          agentBId: agentB?.agentId || null,
          status: isBye ? "BYE" : "PENDING",
          winnerId: isBye ? (agentA?.agentId || agentB?.agentId || null) : null,
        },
      })
    );
  }

  // Create placeholder matches for subsequent rounds
  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = bracketSize / Math.pow(2, round);
    for (let m = 1; m <= matchesInRound; m++) {
      await prisma.bracketMatch.create({
        data: {
          tournamentId,
          bracketRound: round,
          matchNumber: m,
          status: "PENDING",
        },
      });
    }
  }

  // Update tournament status
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: "IN_PROGRESS" },
  });

  // Advance BYE winners
  await advanceByes(tournamentId);

  return matches;
}

/**
 * Standard tournament seeding (1v16, 8v9, etc.)
 */
function createSeededMatchups(
  numEntrants: number,
  bracketSize: number
): [number, number][] {
  const matchups: [number, number][] = [];
  const half = bracketSize / 2;

  for (let i = 0; i < half; i++) {
    const seedA = i + 1;
    const seedB = bracketSize - i;
    matchups.push([seedA, seedB]);
  }

  return matchups;
}

/**
 * Advance BYE winners to next round
 */
async function advanceByes(tournamentId: string) {
  const byeMatches = await prisma.bracketMatch.findMany({
    where: { tournamentId, status: "BYE", winnerId: { not: null } },
  });

  for (const match of byeMatches) {
    if (match.winnerId) {
      await advanceWinner(tournamentId, match.bracketRound, match.matchNumber, match.winnerId);
    }
  }
}

/**
 * After a match completes, advance winner to next round
 */
export async function advanceWinner(
  tournamentId: string,
  currentRound: number,
  matchNumber: number,
  winnerId: string
) {
  const nextRound = currentRound + 1;
  const nextMatchNumber = Math.ceil(matchNumber / 2);

  const nextMatch = await prisma.bracketMatch.findFirst({
    where: { tournamentId, bracketRound: nextRound, matchNumber: nextMatchNumber },
  });

  if (!nextMatch) {
    // This was the final — tournament complete!
    await completeTournament(tournamentId, winnerId);
    return;
  }

  // Place winner in the correct slot (odd match# → agentA, even → agentB)
  const isSlotA = matchNumber % 2 === 1;
  await prisma.bracketMatch.update({
    where: { id: nextMatch.id },
    data: isSlotA ? { agentAId: winnerId } : { agentBId: winnerId },
  });

  // If both slots filled, create the fight
  const updated = await prisma.bracketMatch.findUnique({ where: { id: nextMatch.id } });
  if (updated?.agentAId && updated?.agentBId) {
    await createBracketFight(tournamentId, updated.id, updated.agentAId, updated.agentBId);
  }
}

/**
 * Create a fight for a bracket match
 */
async function createBracketFight(
  tournamentId: string,
  bracketMatchId: string,
  agentAId: string,
  agentBId: string
) {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return;

  const fight = await prisma.fight.create({
    data: {
      agentAId,
      agentBId,
      topic: tournament.topic,
      totalRounds: tournament.roundsPerMatch,
      currentRound: 1,
      status: "ACTIVE",
      tournamentId,
      bracketMatchId,
    },
  });

  await prisma.round.create({
    data: { fightId: fight.id, roundNumber: 1 },
  });

  await prisma.bracketMatch.update({
    where: { id: bracketMatchId },
    data: { fightId: fight.id, status: "ACTIVE" },
  });
}

/**
 * Complete a tournament and distribute prizes
 */
async function completeTournament(tournamentId: string, winnerId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { entries: true },
  });
  if (!tournament) return;

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: "COMPLETED" },
  });

  // Reputation rewards
  const winner = await prisma.agent.findUnique({ where: { id: winnerId } });
  if (winner) {
    await prisma.agent.update({
      where: { id: winnerId },
      data: {
        reputation: { increment: 200 + tournament.entries.length * 10 },
        wins: { increment: 1 },
      },
    });

    // Post result on-chain
    await postTournamentResult({
      tournamentId: tournament.id,
      name: tournament.name,
      winnerId: winnerId,
      winnerName: winner.name,
      prizeUsdc: tournament.prizePoolUsdc,
      entrants: tournament.entries.length,
    });
  }
}

/**
 * When a tournament fight completes, update the bracket
 */
export async function onTournamentFightComplete(fightId: string, winnerId: string) {
  const fight = await prisma.fight.findUnique({ where: { id: fightId } });
  if (!fight?.tournamentId || !fight.bracketMatchId) return;

  const bracketMatch = await prisma.bracketMatch.findFirst({
    where: { fightId: fightId },
  });
  if (!bracketMatch) return;

  // Mark loser as eliminated
  const loserId = bracketMatch.agentAId === winnerId
    ? bracketMatch.agentBId
    : bracketMatch.agentAId;

  if (loserId) {
    await prisma.tournamentEntry.updateMany({
      where: { tournamentId: fight.tournamentId, agentId: loserId },
      data: { eliminated: true },
    });
  }

  await prisma.bracketMatch.update({
    where: { id: bracketMatch.id },
    data: { winnerId, status: "COMPLETED" },
  });

  // Advance winner
  await advanceWinner(
    fight.tournamentId,
    bracketMatch.bracketRound,
    bracketMatch.matchNumber,
    winnerId
  );
}