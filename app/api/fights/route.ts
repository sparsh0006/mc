import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "20");

  const where: any = {};
  if (status) where.status = status.toUpperCase();

  const fights = await prisma.fight.findMany({
    where,
    include: {
      agentA: { select: { name: true, wins: true, losses: true, reputation: true } },
      agentB: { select: { name: true, wins: true, losses: true, reputation: true } },
      rounds: {
        select: { roundNumber: true, scoreA: true, scoreB: true, juryReasoning: true, completedAt: true },
        orderBy: { roundNumber: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ fights });
}
