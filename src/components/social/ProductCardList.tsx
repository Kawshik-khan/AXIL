"use client";

import React from "react";
import { Package } from "lucide-react";
import type { ProductCard } from "@/types/social";
import { cardPrice } from "@/lib/product-card-shape";
import styles from "./ProductCardList.module.css";

interface ProductCardListProps {
  cards: ProductCard[];
  /** A tap on a card's button. Without it the buttons are shown but inactive (the staff inbox's read-only view). */
  onOrder?: (card: ProductCard) => void;
  disabled?: boolean;
}

/**
 * Product cards in a chat: photo, title, price and an order button, in a row that scrolls sideways. The look (lime,
 * dark or light) is the shop's template setting, carried on each card.
 */
export const ProductCardList: React.FC<ProductCardListProps> = ({ cards, onOrder, disabled = false }) => {
  if (!cards.length) return null;
  return (
    <ul className={styles.row} aria-label="Products">
      {cards.map((card) => (
        <li key={card.product_id} className={`${styles.card} ${styles[card.theme ?? "lime"] ?? ""}`}>
          <div className={styles.media}>
            {card.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- product photos come from the media bucket
              <img src={card.image_url} alt={card.title} className={styles.image} loading="lazy" />
            ) : (
              <Package size={28} aria-hidden />
            )}
          </div>
          <div className={styles.body}>
            <div className={styles.title} title={card.title}>
              {card.title}
            </div>
            <div className={styles.priceRow}>
              <span className={styles.price}>{cardPrice(card)}</span>
              {card.regular_price_bdt && <span className={styles.regular}>৳{card.regular_price_bdt.toLocaleString("en-IN")}</span>}
            </div>
            <button
              type="button"
              className={styles.button}
              disabled={!card.in_stock || !onOrder || disabled}
              onClick={() => onOrder?.(card)}
            >
              {card.button_label}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};
