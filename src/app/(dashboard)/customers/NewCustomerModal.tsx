"use client";

import React, { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import styles from "./customers.module.css";

const DIVISIONS = ["Dhaka", "Chittagong", "Rajshahi", "Khulna", "Sylhet", "Barisal", "Rangpur", "Mymensingh"];

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the API created the customer */
  onCreated: () => void | Promise<void>;
}

/** Register a customer by hand (POST /api/v1/customers). */
export function NewCustomerModal({ isOpen, onClose, onCreated }: NewCustomerModalProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [division, setDivision] = useState("Dhaka");
  const [district, setDistrict] = useState("Dhaka");
  const [addressLine, setAddressLine] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const reset = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setAddressLine("");
    setFormError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!firstName.trim()) return setFormError("First name is required.");
    if (!phone.trim()) return setFormError("Phone number is required.");

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim() || "Customer",
          phone: phone.trim(),
          email: email.trim() || undefined,
          address: addressLine.trim() ? { division, district, address_line_1: addressLine.trim() } : undefined,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "The customer could not be created.");
      }
      reset();
      onClose();
      await onCreated();
    } catch (err) {
      setFormError(err instanceof Error && err.message ? err.message : "The customer could not be created.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New customer">
      <form onSubmit={submit} className={styles.form}>
        {formError && (
          <div className={styles.formError} role="alert">
            <AlertCircle size={16} />
            <span>{formError}</span>
          </div>
        )}

        <div className={styles.formRow}>
          <Input label="First name *" placeholder="e.g. Mahfuz" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <Input label="Last name" placeholder="e.g. Rahman" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>

        <Input
          label="Mobile phone *"
          placeholder="01712345678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          hint="Saved in +880 format"
        />

        <Input label="Email (optional)" type="email" placeholder="customer@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />

        <div className={styles.formRow}>
          <label className={styles.field}>
            Division
            <select className={styles.select} value={division} onChange={(e) => setDivision(e.target.value)}>
              {DIVISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <Input label="District" value={district} onChange={(e) => setDistrict(e.target.value)} />
        </div>

        <Input label="Street address / area" placeholder="e.g. House 4, Road 11, Banani" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />

        <div className={styles.formActions}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isLoading={isSubmitting}>
            Add customer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
