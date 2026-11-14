"use client";

import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

/** Shop setup after sign-up. Signed-in owners only: the flow sends anyone else to /login, finished shops to /. */
export default function OnboardingPage() {
  return <OnboardingFlow />;
}
