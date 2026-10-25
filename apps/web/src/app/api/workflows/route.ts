import { NextRequest } from "next/server";
import { getWorkspaceUser } from "@/lib/queries";
import { saveLibraryWorkflow } from "@/lib/workflow-library";
import { WorkflowSelectionSchema } from "@/lib/workflow-selection";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const parsed = WorkflowSelectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose an existing agent for every node.", issues: parsed.error.issues }, { status: 400 });
  const { workspace, user } = await getWorkspaceUser();
  try {
    return Response.json(await saveLibraryWorkflow(workspace, parsed.data, user?.email ?? "operator@local"), { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
