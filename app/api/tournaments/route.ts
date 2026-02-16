// app/api/tournaments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "20");

  const where: any = {};
  if (status) where.status = status.toUpperCase();

  const tournaments = await prisma.tournament.findMany({
    where,
    include: {
      entries: { select: { agentId: true, agent: { select: { name: true } }, eliminated: true, seed: true } },
      _count: { select: { bracketMatches: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    tournaments: tournaments.map((t) => ({
      id: t.id,
      name: t.name,
      topic: t.topic,
      status: t.status,
      format: t.format,
      entrants: `${t.entries.length}/${t.maxEntrants}`,
      entry_fee: `$${t.entryFeeUsdc} USDC`,
      prize_pool: `$${t.prizePoolUsdc} USDC`,
      rounds_per_match: t.roundsPerMatch,
      bracket_matches: t._count.bracketMatches,
      agents: t.entries.map((e) => ({ name: e.agent.name, seed: e.seed, eliminated: e.eliminated })),
      starts_at: t.startsAt,
      created_at: t.createdAt,
    })),
  });
}