import React from "react";
import styles from "./Bento.module.css";

export interface BentoCardProps {
  children: React.ReactNode;
  span?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  title?: string;
  /** A small logo or icon shown before the title. */
  icon?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  isAI?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const BentoCard: React.FC<BentoCardProps> = ({
  children,
  span = 4,
  title,
  icon,
  subtitle,
  action,
  footer,
  isAI = false,
  className = "",
  style,
}) => {
  const colClass = styles[`col${span}` as keyof typeof styles] || styles.col4;
  const aiClass = isAI ? styles.aiGlow : "";
  const titleArea = (
    <div className={styles.titleArea}>
      {title && <h3 className={styles.title}>{title}</h3>}
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  );

  return (
    <div className={`${styles.card} ${colClass} ${aiClass} ${className}`} style={style}>
      {isAI && <span className={styles.aiBadge}>✦ AI Ready</span>}

      {(title || action) && (
        <div className={styles.header}>
          {icon ? (
            <div className={styles.titleWithIcon}>
              {icon}
              {titleArea}
            </div>
          ) : (
            titleArea
          )}
          {action && <div>{action}</div>}
        </div>
      )}

      <div className={styles.content}>{children}</div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
};
