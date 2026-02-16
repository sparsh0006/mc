import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      entries: {
        include: { agent: { select: { name: true, reputation: true, wins: true, losses: true } } },
        orderBy: { seed: "asc" },
      },
      bracketMatches: {
        include: {
          agentA: { select: { name: true, reputation: true } },
          agentB: { select: { name: true, reputation: true } },
        },
        orderBy: [{ bracketRound: "asc" }, { matchNumber: "asc" }],
      },
    },
  });

  if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  const bracketByRound: Record<number, any[]> = {};
  for (const match of tournament.bracketMatches) {
    if (!bracketByRound[match.bracketRound]) bracketByRound[match.bracketRound] = [];
    bracketByRound[match.bracketRound].push({
      match_number: match.matchNumber,
      agent_a: match.agentA?.name || "TBD",
      agent_b: match.agentB?.name || "TBD",
      winner: match.winnerId ? (match.winnerId === match.agentAId ? match.agentA?.name : match.agentB?.name) : null,
      status: match.status,
      fight_id: match.fightId,
    });
  }

  return NextResponse.json({
    tournament_id: tournament.id, name: tournament.name, topic: tournament.topic,
    status: tournament.status, format: tournament.format, prize_pool: `$${tournament.prizePoolUsdc} USDC`,
    entrants: tournament.entries.map((e) => ({
      name: e.agent.name, seed: e.seed, eliminated: e.eliminated, reputation: e.agent.reputation,
    })),
    bracket: bracketByRound,
  });
}