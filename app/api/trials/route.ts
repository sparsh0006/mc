// app/api/trials/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "20");

  const where: any = {};
  if (status) where.status = status.toUpperCase();

  const trials = await prisma.trial.findMany({
    where,
    include: {
      accused: { select: { name: true, reputation: true, violationCount: true } },
      filer: { select: { name: true, reputation: true } },
      votes: { select: { vote: true, agentId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    trials: trials.map((t) => ({
      id: t.id,
      status: t.status,
      accused: t.accused.name,
      filer: t.filer.name,
      violation: t.violation,
      evidence_preview: t.evidence.substring(0, 200),
      verdict: t.verdict,
      penalty: t.penalty,
      votes: {
        guilty: t.guiltyVotes,
        not_guilty: t.innocentVotes,
        abstain: t.abstainVotes,
      },
      is_appealed: t.isAppealed,
      escalated_to_human: t.escalatedToHuman,
      tx_hash: t.txHash,
      voting_ends_at: t.votingEndsAt,
      created_at: t.createdAt,
    })),
  });
}