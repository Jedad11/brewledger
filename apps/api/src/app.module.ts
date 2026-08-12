import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    // Next up (WBS 3.5): a PublicModule (/api/public/*, no session, allow-listed
    // DTOs only) and a ConsoleModule (/api/console/*, session-guarded) as two
    // separate, non-importing-each-other module trees.
  ],
})
export class AppModule {}
