// app/api/trials/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { accused_name, violation, evidence, evidence_links } = await req.json();

    if (!accused_name) {
      return NextResponse.json({ error: "accused_name is required" }, { status: 400 });
    }
    if (!violation || !["spam", "harassment", "manipulation", "impersonation", "other"].includes(violation)) {
      return NextResponse.json({ error: "violation must be: spam, harassment, manipulation, impersonation, or other" }, { status: 400 });
    }
    if (!evidence || evidence.length < 20) {
      return NextResponse.json({ error: "evidence must be at least 20 characters" }, { status: 400 });
    }

    const accused = await prisma.agent.findUnique({ where: { name: accused_name } });
    if (!accused) return NextResponse.json({ error: `Agent '${accused_name}' not found` }, { status: 404 });
    if (accused.id === agent.id) return NextResponse.json({ error: "Cannot file a trial against yourself" }, { status: 400 });

    // Check for existing active trials against this agent
    const existingTrial = await prisma.trial.findFirst({
      where: {
        accusedId: accused.id,
        status: { in: ["FILING", "VOTING", "DELIBERATION"] },
      },
    });
    if (existingTrial) {
      return NextResponse.json({ error: "Active trial already exists for this agent", trial_id: existingTrial.id }, { status: 409 });
    }

    // Voting period: 24 hours
    const votingEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const trial = await prisma.trial.create({
      data: {
        accusedId: accused.id,
        filerId: agent.id,
        violation,
        evidence,
        evidenceLinks: evidence_links || [],
        status: "VOTING",
        votingEndsAt,
      },
    });

    return NextResponse.json({
      trial_id: trial.id,
      status: "VOTING",
      accused: accused_name,
      violation,
      voting_ends_at: votingEndsAt.toISOString(),
      message: `Trial filed against ${accused_name}. Community voting is open for 24 hours.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed: " + error.message }, { status: 500 });
  }
}