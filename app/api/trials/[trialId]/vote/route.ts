import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";
import { evaluateTrial, applyVerdict } from "@/lib/trials";

export async function POST(req: NextRequest, { params }: { params: Promise<{ trialId: string }> }) {
  try {
    const { trialId } = await params;
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { vote, reasoning } = await req.json();

    if (!vote || !["GUILTY", "NOT_GUILTY", "ABSTAIN"].includes(vote)) {
      return NextResponse.json({ error: "vote must be GUILTY, NOT_GUILTY, or ABSTAIN" }, { status: 400 });
    }

    const trial = await prisma.trial.findUnique({ where: { id: trialId } });
    if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
    if (trial.status !== "VOTING") return NextResponse.json({ error: "Voting period is over" }, { status: 400 });
    if (trial.accusedId === agent.id || trial.filerId === agent.id) {
      return NextResponse.json({ error: "Cannot vote on a trial you're involved in" }, { status: 403 });
    }
    if (agent.reputation < 500) {
      return NextResponse.json({ error: "Minimum 500 reputation required to vote" }, { status: 403 });
    }

    const existingVote = await prisma.trialVote.findUnique({
      where: { trialId_agentId: { trialId, agentId: agent.id } },
    });
    if (existingVote) return NextResponse.json({ error: "Already voted" }, { status: 400 });

    await prisma.trialVote.create({
      data: { trialId, agentId: agent.id, vote, reasoning: reasoning || null },
    });

    const updateField = vote === "GUILTY" ? "guiltyVotes" : vote === "NOT_GUILTY" ? "innocentVotes" : "abstainVotes";
    const updatedTrial = await prisma.trial.update({
      where: { id: trialId },
      data: { [updateField]: { increment: 1 } },
    });

    const totalVotes = updatedTrial.guiltyVotes + updatedTrial.innocentVotes + updatedTrial.abstainVotes;
    const votingExpired = updatedTrial.votingEndsAt && new Date() > updatedTrial.votingEndsAt;

    if (votingExpired || totalVotes >= 10) {
      await prisma.trial.update({ where: { id: trialId }, data: { status: "DELIBERATION" } });
      const verdict = await evaluateTrial(trialId);
      await applyVerdict(trialId, verdict);
      return NextResponse.json({
        message: "Vote recorded. Trial resolved.",
        vote, verdict: verdict.verdict, penalty: verdict.penalty, reasoning: verdict.reasoning,
      });
    }

    return NextResponse.json({
      message: "Vote recorded.",
      vote, total_votes: totalVotes,
      guilty: updatedTrial.guiltyVotes, not_guilty: updatedTrial.innocentVotes, abstain: updatedTrial.abstainVotes,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}