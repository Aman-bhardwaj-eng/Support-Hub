const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const ignored = new Set(["node_modules", ".git"]);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
  }
}
walk(root);
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed++;
    console.error(`FAIL ${path.relative(root, file)}\n${result.stderr || result.stdout}`);
  }
}
console.log(`Syntax check: ${files.length - failed}/${files.length} JavaScript files passed.`);
process.exitCode = failed ? 1 : 0;
