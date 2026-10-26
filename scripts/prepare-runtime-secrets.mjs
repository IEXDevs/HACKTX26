import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const folder = path.join(root, "deploy/.secrets");
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const filename = path.join(folder, "astronom-database-url");
if (fs.existsSync(filename)) throw new Error("Runtime files already exist. Refusing to rotate credentials.");
const local = fs.readFileSync(path.join(root, "apps/web/.env.local"), "utf8");
const values = Object.fromEntries(local.split(/\r?\n/).flatMap((line) => {
  const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line);
  return match ? [[match[1], match[2].trim().replace(/^(["'])(.*)\1$/, "$2")]] : [];
}));
const password = randomBytes(32).toString("hex");
const secrets = {
  "astronom-database-url": `postgresql://astronom_app.ljhovyayblfkparawsxr:${password}@aws-1-us-west-2.pooler.supabase.com:6543/postgres`,
  "astronom-credential-encryption-key": randomBytes(32).toString("base64"),
  "astronom-supabase-url": values.NEXT_PUBLIC_SUPABASE_URL,
  "astronom-supabase-anon-key": values.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "astronom-supabase-service-role-key": values.SUPABASE_SERVICE_ROLE_KEY,
};
for (const [name, value] of Object.entries(secrets)) {
  if (!value) throw new Error(`Missing ${name}.`);
  fs.writeFileSync(path.join(folder, name), value, { mode: 0o600, flag: "wx" });
}
// Credential management runs separately from schema migrations so the password
// never enters migration history. The caller must not log this statement.
fs.writeFileSync(path.join(folder, "create-role.sql"), `CREATE ROLE astronom_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}';`, { mode: 0o600 });
console.log("Prepared allowlisted runtime secrets. The local Meta key was excluded.");
