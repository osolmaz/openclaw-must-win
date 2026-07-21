import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { RuntimeAttribution } from "./runtime-attribution.js";
const plugin = definePluginEntry({
    id: "openclaw-must-win",
    name: "OpenClaw Must Win",
    description: "Attribute Git commits to the active model and OpenClaw runtime.",
    register(api) {
        new RuntimeAttribution(api).register();
    },
});
export default plugin;
//# sourceMappingURL=index.js.map