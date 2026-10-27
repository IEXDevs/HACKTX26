import { eq, or, sql } from "drizzle-orm";
import { templates, templateProposals } from "./db/schema";

export function visibleTemplates(workspaceId: string) {
  return or(eq(templates.builtin, true), sql`exists (select 1 from ${templateProposals} where ${templateProposals.templateId} = ${templates.id} and ${templateProposals.workspaceId} = ${workspaceId} and ${templateProposals.status} = 'saved')`);
}
