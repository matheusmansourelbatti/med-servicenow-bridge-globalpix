import { config } from './config.js';
import { createServer, renewWatch } from './server.js';
import { requestIngest } from './ingest.js';

createServer().listen(config.port, () => {
  console.log(`MED bridge listening on :${config.port}`);
});

if (config.google.startWatchOnBoot) {
  // Register the watch and pick up anything that arrived while the service was down.
  // Failures are logged, not fatal: the scheduled jobs retry both.
  renewWatch().catch((err) => console.error('[boot] watch failed:', err.message));
  requestIngest().catch((err) => console.error('[boot] catch-up sweep failed:', err.message));
}
