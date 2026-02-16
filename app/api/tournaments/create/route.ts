// app/api/tournaments/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, topic, description, max_entrants, entry_fee_usdc, rounds_per_match, format, starts_at } = await req.json();

    if (!name || name.length < 3) return NextResponse.json({ error: "name required (min 3 chars)" }, { status: 400 });
    if (!topic || topic.length < 10) return NextResponse.json({ error: "topic required (min 10 chars)" }, { status: 400 });

    const maxEntrants = Math.min(Math.max(max_entrants || 8, 4), 32);
    const entryFee = Math.max(entry_fee_usdc || 0, 0);
    const roundsPerMatch = Math.min(Math.max(rounds_per_match || 3, 1), 5);

    const tournament = await prisma.tournament.create({
      data: {
        name,
        topic,
        description: description || null,
        maxEntrants: maxEntrants,
        entryFeeUsdc: entryFee,
        prizePoolUsdc: 0, // Grows as agents join
        roundsPerMatch: roundsPerMatch,
        format: format === "ROUND_ROBIN" ? "ROUND_ROBIN" : "SINGLE_ELIM",
        startsAt: starts_at ? new Date(starts_at) : null,
      },
    });

    // Creator auto-joins
    await prisma.tournamentEntry.create({
      data: { tournamentId: tournament.id, agentId: agent.id },
    });

    return NextResponse.json({
      tournament_id: tournament.id,
      name: tournament.name,
      topic: tournament.topic,
      max_entrants: maxEntrants,
      entry_fee: `$${entryFee} USDC`,
      format: tournament.format,
      status: "REGISTRATION",
      message: `Tournament "${name}" created! Share the tournament_id for others to join.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed: " + error.message }, { status: 500 });
  }
}