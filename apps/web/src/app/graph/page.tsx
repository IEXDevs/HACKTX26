import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The constellation is per workflow now. */
export default function GraphPage() {
  redirect("/workflows");
}
