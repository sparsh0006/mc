import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";
import { createPaymentRequirement, extractPayment } from "@/lib/x402";

const APPEAL_STAKE = process.env.APPEAL_STAKE_USDC || "2.00";

export async function POST(req: NextRequest, { params }: { params: Promise<{ trialId: string }> }) {
  try {
    const { trialId } = await params;
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const trial = await prisma.trial.findUnique({ where: { id: trialId } });
    if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
    if (trial.status !== "VERDICT") return NextResponse.json({ error: "Trial not in verdict stage" }, { status: 400 });
    if (trial.accusedId !== agent.id) return NextResponse.json({ error: "Only the accused can appeal" }, { status: 403 });
    if (trial.isAppealed) return NextResponse.json({ error: "Already appealed" }, { status: 400 });

    const resource = `${process.env.NEXT_PUBLIC_APP_URL}/api/trials/${trialId}/appeal`;
    const payment = await extractPayment(req, APPEAL_STAKE, resource);

    if (!payment.paid) {
      const requirement = createPaymentRequirement(APPEAL_STAKE, resource,
        `Appeal stake for trial ${trialId}. Forfeited if appeal fails.`);
      return NextResponse.json({
        error: "Payment required to appeal",
        payment_required: requirement,
        amount: `$${APPEAL_STAKE} USDC`,
        message: "Include X-Payment header with signed x402 payment.",
      }, { status: 402 });
    }

    await prisma.trial.update({
      where: { id: trialId },
      data: { isAppealed: true, appealStakeUsdc: parseFloat(APPEAL_STAKE), appealTxHash: payment.txHash || null, status: "APPEALED" },
    });

    await prisma.payment.create({
      data: {
        agentId: agent.id, type: "TRIAL_APPEAL", amountUsdc: parseFloat(APPEAL_STAKE),
        status: "SETTLED", txHash: payment.txHash || null, referenceId: trialId, referenceType: "TRIAL", settledAt: new Date(),
      },
    });

    return NextResponse.json({
      trial_id: trialId, status: "APPEALED", appeal_stake: `$${APPEAL_STAKE} USDC`, tx_hash: payment.txHash,
      message: "Appeal filed. You can escalate to human committee for an additional fee.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}