import React from "react";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import type { Section } from "./dashboard-data";

interface SectionStateProps<T> {
  section: Section<T>;
  /** What the section shows, for the no-permission message ("sales figures") */
  resource: string;
  permission: string;
  children: (data: T) => React.ReactNode;
}

/** Loading, no-permission and error states for one dashboard section; its content once there is data. */
export function SectionState<T>({ section, resource, permission, children }: SectionStateProps<T>) {
  if (section.data !== null) return <>{children(section.data)}</>;
  if (section.loading) return <LoadingSkeleton lines={4} inline />;
  if (section.status === 403) return <PermissionDenied resource={resource} requiredPermission={permission} inline />;
  return <ErrorState message={section.error?.message} requestId={section.error?.request_id} onRetry={section.reload} inline />;
}
