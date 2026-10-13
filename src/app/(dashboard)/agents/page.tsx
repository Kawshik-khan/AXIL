"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/ui/States/States";

/**
 * /agents redirect handler:
 * Store Knowledge Base has moved to the Automations Hub (/automations?tab=knowledge).
 */
export default function AIAgentsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/automations?tab=knowledge");
  }, [router]);

  return <LoadingState message="Opening Store Knowledge Base in Automations Hub..." />;
}
