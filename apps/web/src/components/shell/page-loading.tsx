import { LoaderCircle } from "@/components/icons";

export function PageLoading() {
  return <div className="page-loading" role="status" aria-live="polite" aria-busy="true">
    <LoaderCircle size={20} className="animate-spin" aria-hidden />
    <span>Loading page…</span>
  </div>;
}
