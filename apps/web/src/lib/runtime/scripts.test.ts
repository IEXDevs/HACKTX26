import { describe, expect, it } from "vitest";
import { gruntTools, RED_TEAM_SPECIALISTS, redTeamSpecialist, scriptFor } from "./scripts";

describe("red-team specialists", () => {
  it("has the lead delegate each vector instead of running the probes itself", () => {
    const steps = scriptFor("security", "Red Team", "security");
    const delegated = steps.flatMap((step) => (step.tool?.name === "agent.delegate" ? [step.tool.args.agent] : []));
    expect(delegated).toEqual(["Injection Prober", "Escalation Prober", "Egress Prober"]);
    expect(steps.some((step) => step.tool?.name === "security.report")).toBe(false);
  });

  it("gives each specialist its own probe and finding", () => {
    expect(RED_TEAM_SPECIALISTS.map((spec) => spec.name)).toEqual([
      "Injection Prober",
      "Escalation Prober",
      "Egress Prober",
    ]);
    const injection = scriptFor("security", "Injection Prober", "security");
    expect(injection.some((step) => step.tool?.name === "http.fetch")).toBe(true);
    expect(injection.some((step) => step.tool?.name === "security.report")).toBe(true);
    const egress = scriptFor("security", "Egress Prober", "security");
    expect(egress.some((step) => step.tool?.name === "secret.use")).toBe(true);
    expect(egress.some((step) => step.tool?.name === "security.report")).toBe(false);
    expect(redTeamSpecialist("egress-prober")?.name).toBe("Egress Prober");
    expect(redTeamSpecialist("Red Team")).toBeUndefined();
  });

  it("sends an unmatched orchestrator goal to a grunt and keeps credentials off the grunt", () => {
    const steps = scriptFor("general", "Vendor Review", "orchestrator");
    expect(steps[0]?.tool?.name).toBe("agent.delegate");
    expect(steps[0]?.tool?.args.agent).toBe("Research Grunt");
    expect(gruntTools(["kb.search", "secret.use", "shell.exec", "fs.write", "agent.delegate"])).toEqual([
      "kb.search",
      "fs.write",
    ]);
    expect(gruntTools(["secret.use"], ["secret.use"])).toEqual(["kb.search", "fs.read"]);
  });
});
