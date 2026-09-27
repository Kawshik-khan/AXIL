import React from "react";
import styles from "./Badge.module.css";

export interface BadgeProps {
  children: React.ReactNode;
  variant?:
    | "owner"
    | "admin"
    | "dev"
    | "manager"
    | "sales"
    | "support"
    | "marketing"
    | "inventory"
    | "finance"
    | "analyst"
    | "active"
    | "success"
    | "pending"
    | "inactive"
    | "default"
    | "role"
    | "invited"
    | "suspended"
    | "deactivated";
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "sales",
  className = "",
}) => {
  return (
    <span className={`${styles.badge} ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
};
