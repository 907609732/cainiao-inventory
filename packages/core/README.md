# cainiao-inventory-automation-core

Reusable Node.js 22 module for Cainiao daily inventory export validation, reporting, DingTalk delivery, local run manifests, and macOS launchd scheduling.

```js
import { createCainiaoAutomation } from "cainiao-inventory-automation-core";

const automation = createCainiaoAutomation();
const doctor = await automation.doctor();
const result = await automation.runInventory({ mode: "validate_only" });
```

Secrets are stored in macOS Keychain. A validation failure never falls back to an older export and never enters the delivery stage.

See the [plugin repository](https://github.com/907609732/cainiao-inventory/blob/main/docs/macos-plugin.md) for setup, security boundaries, and release artifacts.
