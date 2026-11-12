import { hash } from "bcryptjs";
import { PrismaClient, Role, UnitStatus, SalarySystem } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash("password123", 10);

  const owner = await prisma.user.upsert({
    where: { email: "owner@felix.local" },
    update: {},
    create: {
      name: "Owner Felix",
      email: "owner@felix.local",
      passwordHash,
      role: Role.OWNER,
    },
  });

  await prisma.user.upsert({
    where: { email: "admin@felix.local" },
    update: {},
    create: {
      name: "Admin Ops",
      email: "admin@felix.local",
      passwordHash,
      role: Role.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: "finance@felix.local" },
    update: {},
    create: {
      name: "Finance",
      email: "finance@felix.local",
      passwordHash,
      role: Role.FINANCE,
    },
  });

  const activeCost = await prisma.masterCostConfig.findFirst({
    where: { isActive: true },
  });
  if (!activeCost) {
    await prisma.masterCostConfig.create({
      data: {
        name: "Default 2026",
        isActive: true,
        globalSolarPrice: 15_000,
        globalTirePrice: 12_000_000,
        tireLifespanDays: 180,
        defaultMaintenanceBudget: 5_000_000,
        defaultCicilan: 15_000_000,
        defaultDepreciation: 250_000,
        defaultMovingCost: 2_000_000,
        estimatedOpsDaysPerMonth: 25,
      },
    });
  }

  // Akun login supir: username "budi" / password123
  const budiUser = await prisma.user.upsert({
    where: { email: "budi" },
    update: {},
    create: {
      name: "Budi Santoso",
      email: "budi",
      passwordHash,
      role: Role.OPERATOR,
    },
  });

  const driver = await prisma.masterDriver.upsert({
    where: { driverId: "DRV-001" },
    update: {},
    create: {
      name: "Budi Santoso",
      driverId: "DRV-001",
      salarySystem: SalarySystem.PER_TON,
      driverRatePerTon: 8_000,
      userId: budiUser.id,
    },
  });

  await prisma.masterUnit.upsert({
    where: { unitNumber: "DT-01" },
    update: {},
    create: {
      unitNumber: "DT-01",
      brandType: "Hino 500",
      year: 2022,
      licensePlate: "DA 1234 AB",
      capacity: 30,
      status: UnitStatus.RUNNING,
      currentKm: 45000,
      defaultDriverId: driver.id,
      purchasePrice: 850_000_000,
      estimatedSalvageValue: 150_000_000,
      economicLifespanDays: 1500,
    },
  });

  const existingCustomer = await prisma.masterCustomer.findFirst({
    where: { customerName: "PT Batubara Sejahtera" },
  });
  if (!existingCustomer) {
    await prisma.masterCustomer.create({
      data: {
        customerName: "PT Batubara Sejahtera",
        loadingLocation: "Pit A — Tabang",
        dumpingLocation: "Port Samarinda",
        oneWayDistance: 42,
        ratePerTon: 70_000,
        targetTonase: 50_000,
        trips: {
          create: [
            { name: "Pit A → Port Samarinda", distanceKm: 42, uangJalan: 250_000 },
            {
              name: "Pit B → Port Samarinda",
              distanceKm: 55,
              ratePerTon: 80_000,
              uangJalan: 300_000,
            },
          ],
        },
      },
    });
  }

  console.log("Seed OK. Owner:", owner.email, "/ password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
