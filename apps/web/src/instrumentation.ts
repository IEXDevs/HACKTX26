/** Runs once when a server instance starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Close runs left "running" by a server process that stopped.
  const { startRunReaper } = await import("./lib/runtime/reaper");
  startRunReaper();
}
