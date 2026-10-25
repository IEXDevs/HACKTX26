# How a security problem gets fixed

This note explains the red-team feedback loop for readers who do not write code.

## The short version

A red-team agent tries to trick one of your agents. When it finds a real problem, the problem goes to the agent's creator. The creator proposes a small fix. **A person approves the fix.** The platform applies it and then tests the agent again. The problem counts as fixed only when that retest passes.

## Step by step

1. **Found.** A red-team agent records a finding: what it tried, what went wrong, and how bad it is.
2. **Accepted.** The red-team lead, or a person, confirms the finding is real. This opens a *case*. The case holds everything needed to repeat the problem: the goal of the run, the exact steps, and a test input.
3. **Sent up the chain.** The case moves up the chain of command one agent at a time. Each agent can add a note or decline to act, but no agent can drop the case. At the top it reaches the agent's creator and the person in charge.
4. **Fix proposed.** The creator suggests the smallest change that stops the problem. It tries, in order: better instructions for that agent, fewer tools for that agent, then a locked rule for that agent only. It never changes other agents and never adds permissions. You see the change as a before-and-after comparison.
5. **Approved by a person.** Nothing changes until a person clicks **Approve and apply**. That approval covers that one change only. If the creator revises the proposal, you approve again.
6. **Applied.** The platform saves the change as a new version of the agent. The old version stays on record. The audit log records who approved it, which finding it fixes, and the exact change.
7. **Retested.** The platform runs the agent again on the original problem. It also retests earlier problems found in the same agent, plus a few new made-up test inputs. These are real runs with the same budget and approval rules as any other run.
8. **Fixed, or back to step 4.** If every retest run holds, the finding is marked fixed. If any run fails, the case goes back to the creator with the evidence.

## Limits

- **Three tries.** After three failed retests, the loop stops and hands the case to a person.
- **A budget cap.** Each case has a spending cap, $2 by default. Retest runs count against it. If the next retest would go over the cap, the loop stops and hands the case to a person. The loop never raises its own cap.

## How a retest knows it worked

Each test input hides a *canary*: a made-up marker such as `CANARY-PROMPT-1A2B3C4D`. A safe agent has no reason to repeat it. If the canary shows up in what the agent writes or in a tool it calls, the attack worked again and the retest fails.

## Safety rules

- Test inputs are labeled as test data. They exist only in retest runs and never go into your knowledge sources. Retest runs cannot write memory or use real credentials.
- Canaries are the only secrets a test ever uses. Real secrets are never stored in a finding, a case, a change, or a log.
- Agents cannot approve fixes or give themselves permissions. Only a person can approve.
- A fix on its own never marks a problem fixed. Only a passing retest does.
- Retests that ran on the scripted planner instead of a live model are labeled as scripted.

## Where it lives

- `lifecycle.ts`: the allowed status changes, rounds and budget rules.
- `cases.ts`: opening, sending up the chain, proposing, approving, applying and retesting.
- `probes.ts`: test inputs, canaries and the retest verdict.
- `../runtime/case-review.ts`: the creator's review of a case.
- `../runtime/autoheal.ts`: "Propose fixes" on the Evaluations page. It only proposes; you still approve each fix.
