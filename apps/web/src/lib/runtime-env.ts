/** Keep server configuration in the runtime environment, outside Next's inlining. */
export function runtimeEnv(name: string): string | undefined {
  return Reflect.get(process.env, name) as string | undefined;
}
