import { Builder, type BuilderTemplate } from "@/components/relay/builder";
import { listTemplates } from "@/lib/queries";

export default async function NewAgentPage() {
  const templates: BuilderTemplate[] = (await listTemplates()).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    outcome: t.outcome,
  }));
  return <Builder templates={templates} />;
}
