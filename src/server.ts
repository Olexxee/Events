import { createApp } from "./app.js";
import { loadEnvironment } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./infrastructure/database/prisma.js";
import { createLogger } from "./infrastructure/logging/logger.js";

const environment = loadEnvironment();
const logger = createLogger(environment.LOG_LEVEL);
const app = createApp({ apiPrefix: environment.API_PREFIX });

await connectDatabase();

const server = app.listen(environment.PORT, () => {
  logger.info({ port: environment.PORT, environment: environment.NODE_ENV }, "API server started");
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  server.close(async (error) => {
    if (error) {
      logger.error({ error }, "HTTP server shutdown failed");
      process.exitCode = 1;
    }
    await disconnectDatabase();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
