import { Home } from "@/components/relay/home";
import { requireWorkspace } from "@/lib/queries";
import { homeView } from "@/lib/views";

export default async function HomePage() {
  const workspace = await requireWorkspace();
  return <Home data={await homeView(workspace.id)} />;
}
