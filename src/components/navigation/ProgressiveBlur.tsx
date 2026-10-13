"use client";

import React, { useEffect, useState } from "react";
import styles from "./Shell.module.css";

/** The stacked top-edge blur shared by the merchant dashboard and the platform console; shows once the page scrolls. */
export const ProgressiveBlur: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const currentScroll = window.scrollY || document.documentElement.scrollTop;
      setIsScrolled(currentScroll > 12);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div
      className={`${styles.progressiveBlurContainer} ${isScrolled ? styles.progressiveBlurActive : ""}`}
      aria-hidden="true"
    >
      <div className={styles.blurFilter} />
      <div className={styles.blurFilter} />
      <div className={styles.blurFilter} />
      <div className={styles.blurFilter} />
      <div className={styles.blurFilter} />
      <div className={styles.blurFilter} />
      <div className={styles.blurFilter} />
      <div className={styles.blurGradient} />
    </div>
  );
};
