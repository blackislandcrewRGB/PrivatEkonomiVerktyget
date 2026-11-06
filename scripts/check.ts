/**
 * Everything before a commit, in one command:
 *
 *   git add -A && npm run check && git commit -m "…"
 *   npm run check -- --no-tests     # only the quick checks
 *
 * The type checks and the personal-data check (on what is staged) run at the
 * same time; if one fails the tests don't run. Then the whole suite. Quiet:
 * one line when everything passes, only the failing checks' output when not.
 * Local hook tests (.claude/hooks/test, not in git) run too when they are there.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface Step {
  name: string;
  cmd: string;
  args: string[];
}
interface Result extends Step {
  code: number;
  out: string;
  ms: number;
}

const root = path.resolve(import.meta.dirname, "..");
const noTests = process.argv.includes("--no-tests");

function run(step: Step): Promise<Result> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ ...step, code: 1, out: out + String(e), ms: Date.now() - start }));
    child.on("close", (code) => resolve({ ...step, code: code ?? 1, out, ms: Date.now() - start }));
  });
}

const quick: Step[] = [
  { name: "typkontroll server", cmd: "npx", args: ["tsc", "-p", "server/tsconfig.json", "--noEmit", "--pretty", "false"] },
  { name: "typkontroll webb", cmd: "npx", args: ["tsc", "-p", "web/tsconfig.json", "--noEmit", "--pretty", "false"] },
  { name: "personuppgifter", cmd: "bash", args: ["scripts/personuppgifter.sh"] },
];
const hookTests = path.join(root, ".claude/hooks/test");
if (fs.existsSync(hookTests)) quick.push({ name: "krokarna", cmd: process.execPath, args: ["--test", ".claude/hooks/test/*.test.mjs"] });

const report = (r: Result) => {
  console.error(`\n== ${r.name}: RÖTT (exit ${r.code})`);
  // The suite's failures are at its end; the other checks are short.
  const lines = r.out.trimEnd().split("\n");
  const from = lines.findIndex((l) => /Failed Tests|FAIL\b|✖ failing tests/.test(l));
  console.error((from >= 0 ? lines.slice(from) : lines.slice(-80)).join("\n"));
};

const t0 = Date.now();
const results = await Promise.all(quick.map(run));
const red = results.filter((r) => r.code !== 0);
if (red.length) {
  red.forEach(report);
  console.error(`\n== check: ${red.map((r) => r.name).join(", ")} rött${noTests ? "" : "; testerna kördes inte"}.`);
  process.exit(1);
}
let tests = "testerna inte körda (--no-tests)";
if (!noTests) {
  const suite = await run({ name: "testerna", cmd: "npx", args: ["vitest", "run"] });
  if (suite.code !== 0) {
    report(suite);
    console.error("\n== check: testerna rött.");
    process.exit(1);
  }
  const passed = suite.out.match(/Tests\s+(\d+) passed/)?.[1];
  tests = `${passed ?? "?"} tester`;
}
console.log(`== check: grönt (${results.map((r) => r.name).join(", ")}; ${tests}; ${Math.round((Date.now() - t0) / 1000)} s)`);
