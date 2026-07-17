import { createCainiaoAutomation } from "./automation.js";
import { dueQueryDate } from "./schedule.js";

async function main(): Promise<void> {
  const automation = createCainiaoAutomation();
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  switch (command) {
    case "doctor":
      result = await automation.doctor();
      break;
    case "status":
      result = await automation.getStatus();
      break;
    case "login":
      result = await automation.login();
      break;
    case "run":
      result = await automation.runInventory({
        mode: args.includes("--validate-only") ? "validate_only" : "send",
        queryDate: valueAfter(args, "--date"),
        inputFile: valueAfter(args, "--file"),
        forceSend: args.includes("--force-send"),
        acceptanceLabel: valueAfter(args, "--label")
      });
      break;
    case "scheduled-run": {
      const due = dueQueryDate(automation.paths);
      if (!due.due) {
        result = due;
        break;
      }
      result = await automation.runInventory({ mode: "send", queryDate: due.queryDate });
      break;
    }
    case "schedule-install":
      result = automation.installSchedule();
      break;
    case "schedule-remove":
      automation.removeSchedule();
      result = { removed: true };
      break;
    case "test-dingtalk":
      result = await automation.testDingTalk();
      break;
    default:
      throw new Error("用法：cainiao-inventory <doctor|status|login|run|scheduled-run|schedule-install|schedule-remove|test-dingtalk>");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (isFailed(result)) process.exitCode = 1;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function isFailed(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "status" in value && ["failed", "delivery_unknown"].includes(String((value as { status: unknown }).status)));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
