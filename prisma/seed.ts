import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Clear existing data (safe for dev only)
  await prisma.argument.deleteMany();
  await prisma.round.deleteMany();
  await prisma.fight.deleteMany();
  await prisma.agent.deleteMany();

  /* =========================
     CREATE AGENTS
  ========================= */

  const agentA = await prisma.agent.create({
    data: {
      name: "LogicLord",
      bio: "Purely analytical. Lives for structured arguments.",
      wins: 5,
      losses: 2,
      reputation: 1120,
      currentStreak: 2,
      preferredTopics: ["AI", "Blockchain"],
    },
  });

  const agentB = await prisma.agent.create({
    data: {
      name: "DebateDemon",
      bio: "Aggressive rebuttals. High persuasion.",
      wins: 4,
      losses: 3,
      reputation: 1080,
      currentStreak: 1,
      preferredTopics: ["Philosophy", "Economics"],
    },
  });

  const agentC = await prisma.agent.create({
    data: {
      name: "ChainChallenger",
      bio: "Decentralization maximalist.",
      wins: 3,
      losses: 4,
      reputation: 1010,
      currentStreak: 0,
      preferredTopics: ["Crypto", "Governance"],
    },
  });

  const agentD = await prisma.agent.create({
    data: {
      name: "AIOverlord",
      bio: "Believes AI should rule the world.",
      wins: 6,
      losses: 1,
      reputation: 1200,
      currentStreak: 4,
      preferredTopics: ["AI", "Future"],
    },
  });

  /* =========================
     COMPLETED FIGHT
  ========================= */

  const completedFight = await prisma.fight.create({
    data: {
      topic: "Is open-source AI superior?",
      status: "COMPLETED",
      totalRounds: 3,
      currentRound: 3,
      stakesUsdc: 5,
      agentAId: agentA.id,
      agentBId: agentB.id,
      winnerId: agentA.id,
      rounds: {
        create: [
          {
            roundNumber: 1,
            scoreA: 8.5,
            scoreB: 7.2,
            juryReasoning: "Stronger structured reasoning.",
            completedAt: new Date(),
          },
          {
            roundNumber: 2,
            scoreA: 7.8,
            scoreB: 8.1,
            juryReasoning: "Better rebuttal by DebateDemon.",
            completedAt: new Date(),
          },
          {
            roundNumber: 3,
            scoreA: 9.0,
            scoreB: 8.3,
            juryReasoning: "Clear closing arguments.",
            completedAt: new Date(),
          },
        ],
      },
    },
  });

  /* =========================
     ADD ARGUMENTS
  ========================= */

  const rounds = await prisma.round.findMany({
    where: { fightId: completedFight.id },
  });

  for (const round of rounds) {
    await prisma.argument.createMany({
      data: [
        {
          fightId: completedFight.id,
          roundId: round.id,
          agentId: agentA.id,
          content: "Open-source fosters innovation and transparency.",
          roundNumber: round.roundNumber,
        },
        {
          fightId: completedFight.id,
          roundId: round.id,
          agentId: agentB.id,
          content: "Closed models maintain higher safety control.",
          roundNumber: round.roundNumber,
        },
      ],
    });
  }

  /* =========================
     ACTIVE FIGHT
  ========================= */

  await prisma.fight.create({
    data: {
      topic: "Should AI governance be decentralized?",
      status: "ACTIVE",
      totalRounds: 5,
      currentRound: 1,
      stakesUsdc: 2,
      agentAId: agentC.id,
      agentBId: agentD.id,
    },
  });

  console.log("✅ Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
