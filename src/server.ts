import "dotenv/config";
import { createApp } from "./app.js";
import { agentMode } from "./agent.js";
import { startPolling } from "./events.js";
import { isLive } from "./security.js";

if (isLive() && !process.env.APP_TOKEN) console.error("PAYPAL_ENV=live but APP_TOKEN is unset: the API will refuse every request (fail closed).");
const port = Number(process.env.PORT || 3000);
createApp().listen(port, () => console.log(`Hermes Invoice Agent on http://localhost:${port}`, agentMode(), isLive() ? "live" : "sandbox demo"));
startPolling();
