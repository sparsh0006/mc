import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";
import { checkEligibility } from "@/lib/trials";
import { createPaymentRequirement, extractPayment } from "@/lib/x402";
import { generateBracket } from "@/lib/tournaments";

export async function POST(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  try {
    const { tournamentId } = await params;
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const eligibility = await checkEligibility(agent.id);
    if (!eligibility.eligible) return NextResponse.json({ error: `Not eligible: ${eligibility.reason}` }, { status: 403 });

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { entries: true },
    });
    if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    if (tournament.status !== "REGISTRATION") return NextResponse.json({ error: "Registration closed" }, { status: 400 });

    const existingEntry = tournament.entries.find((e) => e.agentId === agent.id);
    if (existingEntry) return NextResponse.json({ error: "Already entered" }, { status: 400 });
    if (tournament.entries.length >= tournament.maxEntrants) return NextResponse.json({ error: "Tournament full" }, { status: 400 });

    let entryTxHash: string | undefined;
    if (tournament.entryFeeUsdc > 0) {
      const resource = `${process.env.NEXT_PUBLIC_APP_URL}/api/tournaments/${tournamentId}/join`;
      const payment = await extractPayment(req, tournament.entryFeeUsdc.toString(), resource);

      if (!payment.paid) {
        const requirement = createPaymentRequirement(tournament.entryFeeUsdc.toString(), resource,
          `Entry fee for "${tournament.name}". Goes to prize pool.`);
        return NextResponse.json({
          error: "Entry fee required",
          payment_required: requirement,
          amount: `$${tournament.entryFeeUsdc} USDC`,
        }, { status: 402 });
      }

      entryTxHash = payment.txHash;
      await prisma.tournament.update({ where: { id: tournamentId }, data: { prizePoolUsdc: { increment: tournament.entryFeeUsdc } } });
      await prisma.payment.create({
        data: {
          agentId: agent.id, type: "TOURNAMENT_ENTRY", amountUsdc: tournament.entryFeeUsdc,
          status: "SETTLED", txHash: entryTxHash || null, referenceId: tournamentId, referenceType: "TOURNAMENT", settledAt: new Date(),
        },
      });
    }

    await prisma.tournamentEntry.create({
      data: { tournamentId, agentId: agent.id, entryTxHash: entryTxHash || null },
    });

    const updated = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { entries: true } });
    const currentEntries = updated!.entries.length;
    const isFull = currentEntries >= tournament.maxEntrants;

    if (isFull) await generateBracket(tournamentId);

    return NextResponse.json({
  tournament_id: tournamentId,
  name: tournament.name,
  entries: `${currentEntries}/${tournament.maxEntrants}`,
  prize_pool: `$${updated!.prizePoolUsdc} USDC`,
  status: isFull ? "IN_PROGRESS" : "REGISTRATION",
  txHash: entryTxHash || null, 
  explorer: entryTxHash
    ? `https://testnet.monadexplorer.com/tx/${entryTxHash}`
    : null,
  message: isFull
    ? "Tournament full! Bracket generated."
    : `Joined! ${tournament.maxEntrants - currentEntries} spots left.`,
});

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}