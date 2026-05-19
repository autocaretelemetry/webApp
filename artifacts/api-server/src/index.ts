import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Service-reminder generator: runs once at boot and then hourly.
  // Idempotent via (ownerPhone, dedupeKey) — safe to re-run.
  void import("./lib/reminders").then(({ generateServiceReminderNotifications }) => {
    const tick = async () => {
      try {
        const created = await generateServiceReminderNotifications();
        if (created > 0) logger.info({ created }, "Reminder notifications created");
      } catch (e) {
        logger.warn({ err: e }, "Reminder generator failed");
      }
    };
    setTimeout(tick, 10_000);
    setInterval(tick, 60 * 60 * 1000);
  });
});
