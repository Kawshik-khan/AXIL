import { redirect } from "next/navigation";

/** /ai is an alias of the AI console (FX-38: it used to re-export the /agents page as a duplicate). */
export default function AiIndexPage() {
  redirect("/agents");
}
