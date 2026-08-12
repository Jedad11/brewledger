import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db: "ok" | "unreachable" = "unreachable";
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      db = "ok";
    } catch {
      db = "unreachable";
    }

    return {
      status: "ok",
      db,
      timestamp: new Date().toISOString(),
    };
  }
}
