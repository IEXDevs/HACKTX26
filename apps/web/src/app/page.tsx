import { Builder, type BuilderTemplate } from "@/components/relay/builder";
import { listTemplates, requireWorkspace } from "@/lib/queries";

export default async function HomePage() {
  const workspace = await requireWorkspace();
  const templates: BuilderTemplate[] = (await listTemplates()).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    outcome: template.outcome,
  }));
  return <Builder key={workspace.id} accountScope={workspace.id} templates={templates} />;
}
