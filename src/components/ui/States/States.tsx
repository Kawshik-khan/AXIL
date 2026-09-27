"use client";

import React from "react";
import { AlertTriangle, ShieldAlert, FolderOpen } from "lucide-react";
import { Button } from "../Button/Button";
import styles from "./States.module.css";

export const LoadingSkeleton: React.FC<{ lines?: number; height?: string }> = ({
  lines = 3,
  height,
}) => {
  return (
    <div className={styles.skeletonCard} style={height ? { minHeight: height } : undefined}>
      <div className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`${styles.skeletonLine} ${i % 2 === 0 ? styles.skeletonMedium : styles.skeletonShort}`}
        />
      ))}
    </div>
  );
};

export const LoadingState: React.FC<{ message?: string }> = ({
  message = "Loading data...",
}) => {
  return (
    <div className={styles.stateContainer}>
      <div className={styles.skeletonLine} style={{ width: "40px", height: "40px", borderRadius: "50%", margin: "0 auto 16px" }} />
      <h3 className={styles.title}>{message}</h3>
      <p className={styles.description}>Accessing authoritative cryptographic records...</p>
    </div>
  );
};



export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}> = ({ title, description, actionText, onAction, icon }) => {
  return (
    <div className={styles.stateContainer}>
      <div className={styles.iconWrapper}>
        {icon || <FolderOpen size={28} />}
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {actionText && onAction && (
        <div className={styles.actionWrapper}>
          <Button variant="primary" onClick={onAction}>
            {actionText}
          </Button>
        </div>
      )}
    </div>
  );
};

export const ErrorState: React.FC<{
  title?: string;
  message?: string;
  requestId?: string;
  onRetry?: () => void;
}> = ({
  title = "Something went wrong",
  message = "An error occurred while loading this view.",
  requestId,
  onRetry,
}) => {
  return (
    <div className={styles.stateContainer}>
      <div className={styles.iconWrapper} style={{ color: "var(--color-danger)" }}>
        <AlertTriangle size={28} />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{message}</p>
      {requestId && (
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          Error Reference: <code>{requestId}</code>
        </span>
      )}
      {onRetry && (
        <div className={styles.actionWrapper}>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
};

export const PermissionDenied: React.FC<{
  resource?: string;
  requiredPermission?: string;
}> = ({ resource = "this section", requiredPermission }) => {
  return (
    <div className={styles.stateContainer}>
      <div className={styles.iconWrapper} style={{ color: "var(--color-warning)" }}>
        <ShieldAlert size={28} />
      </div>
      <h3 className={styles.title}>Access Restricted</h3>
      <p className={styles.description}>
        Your role does not possess the permissions required to view or modify {resource}.
        {requiredPermission && (
          <span style={{ display: "block", marginTop: "4px", fontSize: "11px" }}>
            Missing scope: <code>{requiredPermission}</code>
          </span>
        )}
      </p>
    </div>
  );
};
