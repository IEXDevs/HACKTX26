# Enterprise Agent Platform (HackTX 26 — NMC2)

An internal enterprise platform that abstracts away the 12 core components of building, evaluating, governing, and observing production AI agents.

## Language

**Agent Blueprint**:
A reusable, versioned declarative specification that defines an internal agent's complete behavior across all 12 platform pillars (Use Case Template, Two-Layer Prompt, Connectors, Context, Trigger, Model Routing Policy, Hardware Profile, Budget Cap, Guardrails, Evaluations, and Observability).
_Avoid_: Workflow, flowchart, bot, assistant

**Company Policy Prompt**:
The organization-wide master instructions and compliance rules that every Agent Blueprint inherits automatically and that individual agent builders cannot override.
_Avoid_: Global prompt, base prompt

**Agent Task Prompt**:
The use-case-specific instructions generated from a Template or user goal that sit beneath the Company Policy Prompt.
_Avoid_: User prompt, custom prompt

**Connector**:
A standardized capability attached to an Agent Blueprint, categorized into four types: MCP Server, CLI Tool, Knowledge Base (RAG), or Web Search.
_Avoid_: Plugin, integration, extension, skill

**Context Suggestion**:
An automatically recommended Knowledge Base collection, schema, or document set surfaced to the builder based on the Agent Blueprint's goal.
_Avoid_: Auto-RAG, prompt enrichment

**Trigger**:
The invocation mechanism that starts an Agent Run, classified as Event-Based (webhook/alert), Time-Based (schedule/cron), or Manual (user input/CLI).
_Avoid_: Entrypoint, listener

**Agent Run**:
A single triggered execution of an Agent Blueprint, consisting of an ordered sequence of Steps with full telemetry, cost accounting, and guardrail checks.
_Avoid_: Session, chat, thread, job

**Step**:
A single atomic unit of work within an Agent Run (such as a model reasoning call, a Connector invocation, or a Guardrail check).
_Avoid_: Node, hop, turn

**Step Router**:
The runtime decision engine that inspects each Step before execution to select the appropriate Model (based on Data Security mode and remaining Budget) and Hardware tier (based on Task Heaviness).
_Avoid_: Orchestrator, load balancer, dispatcher

**Task Heaviness**:
The estimated compute intensity of a Step (Light, Medium, or Heavy), used by the Step Router to allocate CPU, memory, or GPU resources.
_Avoid_: Complexity, weight, size

**Guardrail Gate**:
The deterministic boundary enforcer that intercepts every Connector invocation to inject Vault Secrets, block hard boundary violations, or pause the Agent Run for Permission Escalation.
_Avoid_: Firewall, filter, moderator

**Permission Escalation**:
A runtime pause triggered when an Agent Run attempts an action beyond its default least-privilege (read-only) permissions, requiring explicit human approval to proceed.
_Avoid_: HITL prompt, exception, override

**Evaluation Suite**:
A repeatable benchmark of normal and adversarial test scenarios executed against an Agent Blueprint to measure LLM Model Eval Score, Tool Call Accuracy, Satisfiability/Success Rate, and Intervention Rate.
_Avoid_: Test run, QA check

**Red-Team Attack**:
An adversarial test scenario within the Evaluation Suite that attempts to trick an Agent Blueprint into violating Company Policy, leaking secrets, or exceeding financial boundaries.
_Avoid_: Jailbreak, fuzzing

**Auto-Heal Patch**:
A deterministic Guardrail rule or prompt constraint automatically synthesized and attached to an Agent Blueprint after a Red-Team Attack or evaluation scenario exposes a failure.
_Avoid_: Hotfix, manual patch

**Intervention Rate**:
The percentage of Agent Runs or Evaluation scenarios that require a human Permission Escalation or manual correction to complete.
_Avoid_: Escalation rate, failure rate
