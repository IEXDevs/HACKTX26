import { notFound } from "next/navigation";
import { RunPage } from "@/components/relay/run-page";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await RunPage({ runId: id })) ?? notFound();
}
