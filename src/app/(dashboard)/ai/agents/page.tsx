import { redirect } from "next/navigation";

/** Redirect orphan sub-route /ai/agents to unified /agents control center */
export default function AiAgentsRedirectPage() {
  redirect("/agents");
}
