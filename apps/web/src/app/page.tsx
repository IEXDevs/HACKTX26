import { Builder, type BuilderTemplate } from "@/components/relay/builder";
import { listTemplates } from "@/lib/queries";

export default async function HomePage() {
  const templates: BuilderTemplate[] = (await listTemplates()).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    outcome: template.outcome,
  }));
  return <Builder templates={templates} />;
}
