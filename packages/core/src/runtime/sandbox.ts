import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

export class SandboxViolation extends Error {
  constructor(
    message: string,
    readonly attemptedPath: string,
  ) {
    super(message);
    this.name = "SandboxViolation";
  }
}

const MAX_RELATIVE_PATH = 512;

/**
 * Resolve `rel` inside `root`, refusing anything that escapes.
 *
 * Mirrors the checks a real sandbox needs: no absolute paths, no null bytes, no
 * traversal after normalisation, and no `.`-prefixed escapes on Windows where
 * `C:foo` is drive-relative.
 */
export function resolveInside(root: string, rel: string): string {
  if (rel.includes("\u0000")) {
    throw new SandboxViolation("Path contains a null byte.", rel);
  }
  if (rel.length > MAX_RELATIVE_PATH) {
    throw new SandboxViolation("Path is unreasonably long.", rel);
  }
  if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("\\\\")) {
    throw new SandboxViolation("Absolute paths are not permitted.", rel);
  }

  const rootAbs = resolve(root);
  const target = resolve(rootAbs, normalize(rel));
  const relToRoot = relative(rootAbs, target);

  if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    throw new SandboxViolation("Path escapes the agent sandbox.", rel);
  }
  if (relToRoot.split(sep).some((segment) => segment === "..")) {
    throw new SandboxViolation("Path escapes the agent sandbox.", rel);
  }

  return target;
}

export function isInside(root: string, candidate: string): boolean {
  const relToRoot = relative(resolve(root), resolve(candidate));
  return relToRoot === "" || (!relToRoot.startsWith("..") && !isAbsolute(relToRoot));
}

/** Normalise to forward slashes so the UI tree is stable across platforms. */
export function toPosixPath(p: string): string {
  return p.split(sep).join("/");
}
