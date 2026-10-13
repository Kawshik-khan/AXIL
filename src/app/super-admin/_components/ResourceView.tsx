"use client";

import React from "react";
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { HairlineFigure, type FigureKind } from "@/components/motion/HairlineFigure";
import type { ResourceState } from "../_lib/use-platform-resource";

export interface ResourceViewProps<T> {
  state: ResourceState<T>;
  renderReady: (data: T, meta?: Record<string, unknown>) => React.ReactNode;
  onRetry?: () => void;
  /** What the module is called in the no-permission message. */
  resource: string;
  emptyFigure: FigureKind;
  emptyTitle: string;
  emptyDescription: string;
  emptyActionText?: string;
  onEmptyAction?: () => void;
  /** The card surface, so the figure's plate matches it. */
  surface?: "light" | "dark";
  skeletonLines?: number;
}

/**
 * The six console states for one resource (plan §5.1): loading → skeleton, ready → data, empty → Hairline figure
 * with one action, error → message + request id + Retry, forbidden → the missing permission. Unauthorized never
 * reaches here: platformFetch sends the operator to sign in.
 */
export function ResourceView<T>({
  state,
  renderReady,
  onRetry,
  resource,
  emptyFigure,
  emptyTitle,
  emptyDescription,
  emptyActionText,
  onEmptyAction,
  surface = "light",
  skeletonLines = 3,
}: ResourceViewProps<T>) {
  switch (state.kind) {
    case "loading":
      return <LoadingSkeleton lines={skeletonLines} inline />;
    case "forbidden":
      return <PermissionDenied resource={resource} requiredPermission={state.permission} inline />;
    case "error":
      return (
        <ErrorState
          title={state.status === 0 ? "Platform API unreachable" : "Could not load this view"}
          message={state.message}
          requestId={state.requestId}
          onRetry={onRetry}
          inline
        />
      );
    case "empty":
      return (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionText={emptyActionText}
          onAction={onEmptyAction}
          illustration={<HairlineFigure kind={emptyFigure} surface={surface} />}
          inline
        />
      );
    case "ready":
      return <>{renderReady(state.data, state.meta)}</>;
  }
}
