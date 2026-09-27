"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function UsersRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings#users");
  }, [router]);
  return null;
}
