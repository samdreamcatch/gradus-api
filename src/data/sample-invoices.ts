/**
 * In-memory store for invoices generated against the sample athlete.
 *
 * Sample invoices never touch the database — they live for the current browser
 * session so a coach can generate one, share it, mark it paid and delete it,
 * exactly like the real flow, without any server function being called.
 */

import { useSyncExternalStore } from "react";
import type { InvoiceLineDTO, InvoiceStatus } from "@/lib/invoicing.functions";

export interface SampleInvoice {
  id: string;
  athleteName: string;
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  status: InvoiceStatus;
  createdAt: string;
  lines: InvoiceLineDTO[];
}

const SAMPLE_INVOICE_PREFIX = "sample-invoice-";

export function isSampleInvoiceId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SAMPLE_INVOICE_PREFIX);
}

let invoices: SampleInvoice[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SampleInvoice[] {
  return invoices;
}

const EMPTY: SampleInvoice[] = [];

export function useSampleInvoices(): SampleInvoice[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function listSampleInvoices(): SampleInvoice[] {
  return invoices;
}

export function getSampleInvoice(id: string): SampleInvoice | null {
  return invoices.find((i) => i.id === id) ?? null;
}

export function addSampleInvoice(input: Omit<SampleInvoice, "id" | "status" | "createdAt">) {
  const invoice: SampleInvoice = {
    ...input,
    id: `${SAMPLE_INVOICE_PREFIX}${Date.now()}`,
    status: "unpaid",
    createdAt: new Date().toISOString(),
  };
  invoices = [invoice, ...invoices];
  emit();
  return invoice;
}

export function setSampleInvoiceStatus(id: string, status: InvoiceStatus) {
  invoices = invoices.map((i) => (i.id === id ? { ...i, status } : i));
  emit();
}

export function deleteSampleInvoice(id: string) {
  invoices = invoices.filter((i) => i.id !== id);
  emit();
}

/** Dates already invoiced in this session — kept out of the next draft. */
export function billedSampleDates(): Set<string> {
  const set = new Set<string>();
  for (const inv of invoices) for (const l of inv.lines) set.add(l.occurrenceDate);
  return set;
}
