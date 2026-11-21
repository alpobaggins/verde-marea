import { spawnSync } from "node:child_process";

const suites = ["auth", "availability", "booking", "account", "admin-booking", "admin-availability", "admin-identity"];

function requiredUrl(name) {
  if (!process.env[name]) throw new Error(`Set ${name} before running the strict checks.`);
  const url = URL.parse(process.env[name]);
  if (!url) throw new Error(`Invalid URL in ${name}.`);
  return url;
}

function validateSettings() {
  for (const suite of suites) {
    const name = suite.replaceAll("-", "_");
    const prefix = name.toUpperCase() + "_TEST";
    const database = requiredUrl(prefix + "_DATABASE_URL");
    if (!["postgresql:", "postgres:"].includes(database.protocol)
      || database.pathname !== `/verde_marea_${name}_test` || database.search || database.hash) {
      throw new Error(`Use the dedicated database verde_marea_${name}_test without URL overrides for ${prefix}_DATABASE_URL.`);
    }
    if (suite !== "availability") {
      const app = requiredUrl(prefix + "_APP_URL");
      if (!["http:", "https:"].includes(app.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(app.hostname)) {
        throw new Error(`Use a local test server for ${prefix}_APP_URL.`);
      }
    }
  }
}

function main() {
  validateSettings();
  const generate = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "generate"], { stdio: "inherit" });
  if (generate.status !== 0) throw new Error("Prisma Client generation failed.");

  for (const suite of suites) {
    const run = spawnSync(process.execPath, [
      "--import", "tsx", "--test", "--test-reporter=tap", `tests/${suite}.test.ts`,
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    process.stdout.write(run.stdout ?? "");
    process.stderr.write(run.stderr ?? "");
    const passed = Number(run.stdout?.match(/^# pass (\d+)$/m)?.[1]);
    if (run.status !== 0 || !(passed > 0) || !/^# skipped 0$/m.test(run.stdout ?? "")
      || !/^# todo 0$/m.test(run.stdout ?? "")) {
      throw new Error(`Required suite ${suite} failed or did not run in full.`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
