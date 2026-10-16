import { redirect } from "next/navigation";

/** Redirect orphan sub-route /ai/approvals to unified /agents control center */
export default function AiApprovalsRedirectPage() {
  redirect("/agents");
}
