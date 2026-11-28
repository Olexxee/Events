import express, { type Express } from "express";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { notFoundHandler } from "./shared/middleware/not-found.js";
import { successResponse } from "./shared/responses/success-response.js";
import { pingDatabase } from "./infrastructure/database/prisma.js";
import { requestContext } from "./shared/middleware/request-context.js";
import { corsMiddleware } from "./shared/middleware/cors.js";
import { identityRouter } from "./modules/identity/identity.routes.js";
import { organizersRouter } from "./modules/organizers/organizers.routes.js";
import { eventsRouter } from "./modules/events/events.routes.js";
import { eventAccessRouter } from "./modules/event-access/event-access.routes.js";
import { ticketingRouter } from "./modules/ticketing/ticketing.routes.js";
import { vybeProviderRouter } from "./modules/vybe-provider/vybe-provider.routes.js";
import { vybeCatalogueRouter } from "./modules/vybe-catalogue/vybe-catalogue.routes.js";
import { vybeInventoryRouter } from "./modules/vybe-inventory/vybe-inventory.routes.js";
import { vybeTimeSlotsRouter } from "./modules/vybe-time-slots/vybe-time-slots.routes.js";
import { vybeAccommodationRouter } from "./modules/vybe-accommodation/vybe-accommodation.routes.js";
import { vybeBookingReadsRouter } from "./modules/vybe-bookings/vybe-bookings.reads.routes.js";
import { vybeBookingCancellationsRouter } from "./modules/vybe-bookings/vybe-bookings.cancellations.routes.js";

export interface AppDependencies {
  databasePing?: () => Promise<void>;
  apiPrefix?: string;
  corsOrigins?: string[];
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const prefix = dependencies.apiPrefix ?? "/api/v1";
  const databasePing = dependencies.databasePing ?? pingDatabase;

  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(corsMiddleware(dependencies.corsOrigins ?? ["http://localhost:5173"]));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => successResponse(res, { status: "ok" }));

  app.use(prefix, identityRouter);
  app.use(prefix, organizersRouter);
  app.use(prefix, eventsRouter);
  app.use(prefix, eventAccessRouter);
  app.use(prefix, ticketingRouter);
  app.use(prefix, vybeProviderRouter);
  app.use(prefix, vybeCatalogueRouter);
  app.use(prefix, vybeInventoryRouter);
  app.use(prefix, vybeTimeSlotsRouter);
  app.use(prefix, vybeAccommodationRouter);
  app.use(prefix, vybeBookingReadsRouter);
  app.use(prefix, vybeBookingCancellationsRouter);

  app.get(`${prefix}/health/ready`, async (_req, res) => {
    await databasePing();
    return successResponse(res, { status: "ready", database: "connected" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
