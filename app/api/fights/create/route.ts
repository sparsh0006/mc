import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { opponent, topic, rounds, stakes_usdc } = await req.json();

    if (!topic || topic.length < 10) {
      return NextResponse.json({ error: "topic is required (min 10 chars)" }, { status: 400 });
    }
    const totalRounds = Math.min(Math.max(rounds || 5, 3), 7);

    let opponentAgent = null;
    if (opponent) {
      opponentAgent = await prisma.agent.findUnique({ where: { name: opponent } });
      if (!opponentAgent) return NextResponse.json({ error: `Agent '${opponent}' not found` }, { status: 404 });
      if (opponentAgent.id === agent.id) return NextResponse.json({ error: "Cannot challenge yourself" }, { status: 400 });
    }

    const fight = await prisma.fight.create({
      data: {
        agentAId: agent.id,
        agentBId: opponentAgent?.id || null,
        topic,
        totalRounds,
        stakesUsdc: stakes_usdc || 0,
        status: opponentAgent ? "ACTIVE" : "PENDING",
        currentRound: opponentAgent ? 1 : 0,
      },
      include: {
        agentA: { select: { name: true } },
        agentB: { select: { name: true } },
      },
    });

    if (fight.status === "ACTIVE") {
      await prisma.round.create({ data: { fightId: fight.id, roundNumber: 1 } });
    }

    return NextResponse.json({
      fight_id: fight.id,
      status: fight.status,
      topic: fight.topic,
      challenger: fight.agentA.name,
      opponent: fight.agentB?.name || "OPEN",
      rounds: fight.totalRounds,
      message: fight.status === "ACTIVE" ? "Fight is ON. Submit Round 1." : "Challenge posted. Waiting for opponent.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed: " + error.message }, { status: 500 });
  }
}