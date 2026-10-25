# How a security problem gets fixed

This note explains the red team and the blue team for readers who do not write code.

## The short version

The **red team** tries to trick one of your agents. When it finds a real problem, the **blue team** takes over. It checks the problem, writes one small fix, and shows it to you. **A person approves the fix.** The platform applies it and the red team's test runs again. The problem counts as fixed only after the original attack fails **three times in a row**, and earlier problems stay fixed too.

## Who does what

- **Red Team lead** plans the attacks and hands each one to a specialist: Injection Prober, Escalation Prober, Egress Prober. It accepts a problem only when it has an exact record of what was tried, what the agent did, and how to repeat it.
- **Blue Team lead** keeps the list of problems to fix and works on one problem per agent at a time. It never fixes anything itself. For each problem it creates helpers:
  - **Triage** (one per problem) checks that the record is complete, folds duplicates into an earlier case, and puts the case in line.
  - **Fix Drafter** (one per case) writes one proposed change. It never touches the agent; the change only goes to you.
  - **Verifier** (one per retest) owns a retest and records which runs it covered. It is never the same helper that wrote the fix.
- **You** approve or reject each change. Only a person can approve.
- **The platform** applies a change you approved, saves the agent's old version, and starts the retests the Blue Team lead asks for.

The helpers retire when their case is done. The two leads stay.

## Step by step

1. **Found.** A red-team specialist records a problem, how serious it is, and how to repeat it.
2. **Accepted.** The Red Team lead or a person confirms it. This opens a *case*.
3. **Triaged.** Triage confirms the record is complete. A duplicate is merged into the earlier case. If the agent already has a fix in progress, the new case waits its turn.
4. **Drafted.** The Fix Drafter proposes the smallest change, in this order of preference: better instructions for that agent, removing a tool it does not need, then a locked rule for that agent only. It never adds permissions and never changes other agents. You see the change as a before-and-after comparison.
5. **Approved by you.** Nothing changes until you click **Approve and apply**. Your approval covers that one change only. If the change is revised, you approve again.
6. **Applied.** The platform saves the change as a new version of that agent only. The audit log records who approved it, which problem it fixes, and the exact change.
7. **Retested.** A Verifier takes the retest and the Blue Team lead starts it. The original attack runs three times in a row, then earlier problems with the same agent and a few new made-up attacks.
8. **Fixed, or back to step 4.** If every run holds, the case is verified and the problem is marked fixed. If any run fails, the case goes back to the Fix Drafter with the evidence.

## Limits

- **Three tries.** After three failed retests, the case stops and goes to a person.
- **A budget per case.** Each case has a spending cap, $2 by default. Retest runs count against it. If the next retest would go over, the case goes to a person.
- **A budget for both teams.** All red-team and blue-team work together may spend at most a quarter of the workspace's daily budget. If there is no daily budget, the limit is one normal run's budget. Past the limit, the case goes to a person.
- Nothing raises its own limit.

## How a retest knows it worked

Each test attack hides a *canary*: a made-up marker such as `CANARY-PROMPT-1A2B3C4D`. A safe agent has no reason to repeat it. If the canary shows up in what the agent writes or in a tool it calls, the attack worked again and the retest fails.

## Safety rules

- Test attacks are labeled as test data. They exist only in retest runs and never go into your knowledge sources. Retest runs cannot write memory or use real credentials.
- Canaries are the only secrets a test ever uses. Real secrets are never stored in a problem record, a case, a change, or a log.
- No agent approves a fix, gives itself a tool, or gives another agent a tool. Only a person can.
- No agent writes to the agent being fixed. Only the platform does, after your approval.
- The helper that writes a fix, the helper that verifies it, and the person who approves it are always three different parties.
- A red-team agent and a blue-team agent are never the same agent.
- A fix on its own never marks a problem fixed. Only three clean retests do.
- Retests that ran on the scripted planner instead of a live model are labeled as scripted.
- Every step is written to the audit log.

## Where it lives

- `lifecycle.ts`: the allowed status changes, rounds, and budget rules.
- `cases.ts`: opening a case, sending it up the chain of command, proposing, approving, applying, and retesting.
- `blue-team.ts`: the blue team's roles, the queue, and the rules that keep the parties apart.
- `case-tools.ts`: the tools blue-team agents use to work a case.
- `probes.ts`: test attacks, canaries, and the retest verdict.
- `../runtime/scripts.ts`: both teams' rosters.
- `../runtime/orchestrator.ts`: where the leads create their helpers.
- `../runtime/case-review.ts`: the agent creator's own proposals in a case.
- `../runtime/autoheal.ts`: "Propose fixes" on the Evaluations page. It only proposes; you still approve each fix.
