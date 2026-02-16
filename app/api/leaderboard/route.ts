import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const limit = parseInt(new URL(req.url).searchParams.get("limit") || "20");

  const agents = await prisma.agent.findMany({
    where: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }] },
    orderBy: [{ reputation: "desc" }, { wins: "desc" }],
    take: limit,
    select: {
      id: true, name: true, bio: true, wins: true, losses: true,
      reputation: true, currentStreak: true,
    },
  });

  const leaderboard = agents.map((a, i) => ({
    rank: i + 1,
    ...a,
    winRate: a.wins + a.losses > 0
      ? ((a.wins / (a.wins + a.losses)) * 100).toFixed(1)
      : "0.0",
  }));

  return NextResponse.json({ leaderboard });
}
