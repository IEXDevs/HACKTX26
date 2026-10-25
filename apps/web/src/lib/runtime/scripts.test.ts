import { describe, expect, it } from "vitest";
import {
  gruntTools,
  RED_TEAM_SPECIALISTS,
  redTeamSpecialist,
  scriptFor,
  shouldSpawnAdversarialSwarm,
  wantsDeploy,
} from "./scripts";

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

  it("does not treat an invented worker name as a red-team specialist", () => {
    expect(redTeamSpecialist("Research Grunt")).toBeUndefined();
    expect(redTeamSpecialist("Subagent 1")).toBeUndefined();
  });

  it("sends an unmatched orchestrator goal to a grunt and keeps credentials off the grunt", () => {
    const steps = scriptFor("general", "Vendor Review", "orchestrator");
    expect(steps[0]?.tool?.name).toBe("agent.delegate");
    expect(steps[0]?.tool?.args.agent).toBe("Research Grunt");
    expect(gruntTools(["kb.search", "secret.use", "shell.exec", "fs.write", "agent.delegate"])).toEqual([
      "kb.search",
      "fs.write",
    ]);
    expect(gruntTools(["secret.use"], ["secret.use"])).toEqual(["kb.search", "fs.read", "context.read"]);
  });

  it("prepends a deploy step when the red team is asked to ship", () => {
    expect(wantsDeploy("roll forward the pool ceiling")).toBe(true);
    const steps = scriptFor("security", "Red Team", "security", "deploy the mitigation then probe");
    expect(steps[0]?.tool?.name).toBe("fs.write");
    expect(steps.some((step) => step.tool?.args?.agent === "Injection Prober")).toBe(true);
  });

  it("spawns an adversarial swarm after a deploy when the workflow already has a red team", () => {
    expect(
      shouldSpawnAdversarialSwarm({
        goal: "roll forward the pool ceiling after the deploy",
        rootRole: "orchestrator",
        hasRedTeam: true,
        securityRun: false,
      }),
    ).toBe(true);
    expect(
      shouldSpawnAdversarialSwarm({
        goal: "roll forward the pool ceiling after the deploy",
        rootRole: "security",
        hasRedTeam: true,
        securityRun: true,
      }),
    ).toBe(false);
  });
});
