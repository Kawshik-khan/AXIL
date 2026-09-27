import React from "react";
import styles from "./Bento.module.css";

export interface BentoGridProps {
  children: React.ReactNode;
  className?: string;
}

export const BentoGrid: React.FC<BentoGridProps> = ({ children, className = "" }) => {
  return <div className={`${styles.grid} ${className}`}>{children}</div>;
};
