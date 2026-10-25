import { UsagePage } from "@/components/relay/usage-page";
import { duration, usd } from "@/lib/format";
import { requireWorkspace } from "@/lib/queries";
import { usageView, type UsageRange } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Usage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: asked } = await searchParams;
  const range: UsageRange = asked === "24h" || asked === "all" ? asked : "7d";
  const workspace = await requireWorkspace();
  const data = await usageView(workspace.id, range);
  return (
    <UsagePage
      data={data}
      range={range}
      spend={usd(data.spendUsd)}
      avg={data.avgDurationMs ? duration(data.avgDurationMs) : "—"}
    />
  );
}
