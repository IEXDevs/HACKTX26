export type ComposerAttachment = {
  kind: "github";
  repo: string;
  branch: string;
};

export function formatAttachmentPrefix(items: ComposerAttachment[]): string {
  const lines = items
    .map((item) => {
      if (item.kind === "github") {
        return `Working GitHub repo: ${item.repo} @ ${item.branch}. The checkout is under repo/ in the sandbox.`;
      }
      return "";
    })
    .filter(Boolean);
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

export function applyAttachments(text: string, items: ComposerAttachment[]): string {
  const prefix = formatAttachmentPrefix(items);
  if (!prefix) return text;
  if (text.startsWith(prefix.trim())) return text;
  return `${prefix}${text}`;
}
