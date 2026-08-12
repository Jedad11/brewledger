import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { prisma, type PrismaClient } from "@brewledger/db";

// Thin wrapper around the shared @brewledger/db client so Nest's DI manages
// its lifecycle, without every consumer importing @brewledger/db directly.
//
// Deliberately does NOT $connect() in onModuleInit: Prisma connects lazily
// on first query, so the API boots and stays up even when Postgres is
// unreachable — /api/health reports db: "unreachable" per-request instead
// of the whole app refusing to start.
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
