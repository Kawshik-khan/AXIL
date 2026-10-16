import { redirect } from "next/navigation";

/** Redirect orphan sub-route /ai/workflows to unified /agents control center */
export default function AiWorkflowsRedirectPage() {
  redirect("/agents");
}
