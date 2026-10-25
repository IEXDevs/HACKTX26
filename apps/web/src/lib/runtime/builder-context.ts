import type { BuilderConversation } from "../builder-conversation";
import { redactSecrets } from "../secrets";

function safeText(value: string): string {
  return redactSecrets(value)
    .replace(/(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|client[_ -]?secret)\s*(?:=|:|is)\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]")
    .replace(/([?&](?:api_key|apikey|access_token|refresh_token|token|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/<!--\s*astronom-builder:[\s\S]*?-->/gi, "");
}

/** Keep a named chat record without replacing operator notes or other agents' context. */
export function upsertBuilderContext(content: string, agent: {
  id: string; name: string; summary: string; goal?: string;
}, conversation: BuilderConversation): string {
  if (!conversation.length) return content;
  if (!/^[A-Za-z0-9_-]+$/.test(agent.id)) throw new Error("Invalid agent id for builder context.");
  const start = `<!-- astronom-builder:${agent.id}:start -->`;
  const end = `<!-- astronom-builder:${agent.id}:end -->`;
  const heading = safeText(agent.name).replace(/\s+/g, " ");
  const lines = [
    start, `## Agent setup: ${heading}`, "", safeText(agent.summary),
    ...(agent.goal ? ["", `Initial task: ${safeText(agent.goal)}`] : []),
    "", "### Builder conversation", "",
    "Historical setup context. The saved agent instructions take precedence over earlier ideas in this conversation.", "",
  ];
  for (const message of conversation) {
    lines.push(`**${message.role === "user" ? "Operator" : "Builder"}:**`);
    lines.push(...safeText(message.content).trim().split(/\r?\n/).map((line) => `> ${line}`), "");
  }
  const block = `${lines.join("\n").trimEnd()}\n${end}\n`;
  const from = content.indexOf(start), to = content.indexOf(end, from);
  if (from >= 0 && to >= from) {
    return `${content.slice(0, from)}${block}${content.slice(to + end.length).replace(/^\r?\n/, "")}`;
  }
  return `${content.trimEnd()}\n\n${block}`;
}
