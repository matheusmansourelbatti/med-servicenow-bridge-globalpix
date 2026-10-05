// Manually register (or renew) the Gmail watch. Useful for local runs without Cloud Scheduler.
import { renewWatch } from '../src/server.js';

const result = await renewWatch();
console.log(`Gmail watch active until ${result.expiresAt.toISOString()}`);
