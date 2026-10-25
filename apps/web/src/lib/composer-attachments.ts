export type ComposerAttachment =
  | { kind: "github"; repo: string; branch: string }
  | { kind: "app"; slug: string; name: string };

export function attachmentKey(item: ComposerAttachment): string {
  return item.kind === "github" ? `github:${item.repo}` : `app:${item.slug}`;
}

export function attachmentLabel(item: ComposerAttachment): string {
  return item.kind === "github" ? item.repo : item.name;
}

export function formatAttachmentPrefix(items: ComposerAttachment[]): string {
  const lines = items
    .map((item) => {
      if (item.kind === "github") {
        return `Working GitHub repo: ${item.repo} @ ${item.branch}. The checkout is under repo/ in the sandbox. Use it for this job.`;
      }
      return `Use the linked ${item.name} connection (${item.slug}) for this job when it helps.`;
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
