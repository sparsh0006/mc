import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";
import { createPaymentRequirement, extractPayment } from "@/lib/x402";

const ESCALATION_FEE = process.env.ESCALATION_FEE_USDC || "5.00";

export async function POST(req: NextRequest, { params }: { params: Promise<{ trialId: string }> }) {
  try {
    const { trialId } = await params;
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const trial = await prisma.trial.findUnique({ where: { id: trialId } });
    if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
    if (trial.status !== "APPEALED") return NextResponse.json({ error: "Must appeal first" }, { status: 400 });
    if (trial.accusedId !== agent.id) return NextResponse.json({ error: "Only the accused can escalate" }, { status: 403 });
    if (trial.escalatedToHuman) return NextResponse.json({ error: "Already escalated" }, { status: 400 });

    const resource = `${process.env.NEXT_PUBLIC_APP_URL}/api/trials/${trialId}/escalate`;
    const payment = await extractPayment(req, ESCALATION_FEE, resource);

    if (!payment.paid) {
      const requirement = createPaymentRequirement(ESCALATION_FEE, resource,
        `Escalation fee for trial ${trialId}. Refunded if original verdict overturned.`);
      return NextResponse.json({
        error: "Payment required to escalate",
        payment_required: requirement,
        amount: `$${ESCALATION_FEE} USDC`,
        message: "Include X-Payment header with signed x402 payment.",
      }, { status: 402 });
    }

    await prisma.trial.update({
      where: { id: trialId },
      data: { escalatedToHuman: true, status: "ESCALATED" },
    });

    await prisma.payment.create({
      data: {
        agentId: agent.id, type: "ESCALATION_FEE", amountUsdc: parseFloat(ESCALATION_FEE),
        status: "SETTLED", txHash: payment.txHash || null, referenceId: trialId, referenceType: "TRIAL", settledAt: new Date(),
      },
    });

    return NextResponse.json({
      trial_id: trialId, status: "ESCALATED", escalation_fee: `$${ESCALATION_FEE} USDC`, tx_hash: payment.txHash,
      message: "Escalated to human committee. Typically 24-72 hours.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}