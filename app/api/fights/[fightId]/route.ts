import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ fightId: string }> }) {
  const { fightId } = await params;
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    include: {
      agentA: { select: { name: true, wins: true, losses: true, reputation: true } },
      agentB: { select: { name: true, wins: true, losses: true, reputation: true } },
      rounds: {
        include: { arguments: { select: { agentId: true, content: true, roundNumber: true } } },
        orderBy: { roundNumber: "asc" },
      },
    },
  });
  if (!fight) return NextResponse.json({ error: "Fight not found" }, { status: 404 });
  return NextResponse.json(fight);
}