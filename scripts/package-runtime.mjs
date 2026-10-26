import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(workspace, "apps/web");
const build = path.join(app, ".next");
const standalone = path.join(build, "standalone");
const migrations = path.join(standalone, "apps/web/src/lib/db/pg-migrations");
const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta/_journal.json"), "utf8"));
assert.ok(fs.existsSync(path.join(migrations, "..", "supabase-ca.crt")), "Missing Supabase database CA certificate.");
for (const entry of journal.entries) assert.ok(fs.existsSync(path.join(migrations, `${entry.tag}.sql`)), `Missing packaged migration ${entry.tag}`);

function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function runtimeFile(file) {
  if (!within(workspace, file)) return false;
  const name = path.basename(file);
  return within(path.join(app, ".data"), file) || within(path.join(workspace, ".runtime"), file) || name === ".env" || name.startsWith(".env.");
}

// Next 16 instrumentation traces bypass route-level excludes. Filter those
// generated traces and their copied files without touching the original data.
const pending = [build];
let removed = 0;
while (pending.length) {
  const directory = pending.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (file !== standalone) pending.push(file);
      continue;
    }
    if (!entry.name.endsWith(".nft.json")) continue;
    const trace = JSON.parse(fs.readFileSync(file, "utf8"));
    const files = trace.files.filter((relative) => {
      const source = path.resolve(directory, relative);
      if (!runtimeFile(source)) return true;
      const copied = path.resolve(standalone, path.relative(workspace, source));
      assert.ok(within(standalone, copied), "Refusing to change a file outside the generated package.");
      fs.rmSync(copied, { force: true });
      removed++;
      return false;
    });
    if (files.length !== trace.files.length) {
      const contents = JSON.stringify({ ...trace, files });
      fs.writeFileSync(file, contents);
      const copiedTrace = path.resolve(standalone, path.relative(workspace, file));
      assert.ok(within(standalone, copiedTrace));
      if (fs.existsSync(copiedTrace)) fs.writeFileSync(copiedTrace, contents);
    }
  }
}
// Next can also copy .env and .env.production separately from file tracing.
for (const directory of [standalone, path.join(standalone, "apps/web")]) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name === ".env" || entry.name.startsWith(".env."))) {
      const file = path.resolve(directory, entry.name);
      assert.ok(within(standalone, file));
      fs.rmSync(file);
      removed++;
    }
  }
}
console.log(`Packaged ${journal.entries.length} migrations; excluded ${removed} runtime state trace entries.`);
