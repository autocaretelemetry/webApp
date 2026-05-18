import { BookingStatus, InvoiceStatus, OrderStatus } from "@workspace/api-client-react";

export const BOOKING_STATUS_CONFIG: Record<BookingStatus, { label: string; colorClass: string }> = {
  requested: { label: "Requested", colorClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
  accepted: { label: "Accepted", colorClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  in_progress: { label: "In Progress", colorClass: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800" },
  awaiting_approval: { label: "Awaiting Approval", colorClass: "bg-primary/10 text-primary border-primary/20 dark:bg-primary/20 dark:text-primary-foreground dark:border-primary/30" },
  approved: { label: "Approved", colorClass: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800" },
  completed: { label: "Completed", colorClass: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800" },
  cancelled: { label: "Cancelled", colorClass: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
};

export const INVOICE_STATUS_CONFIG: Record<InvoiceStatus, { label: string; colorClass: string }> = {
  pending_approval: { label: "Pending Approval", colorClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
  approved: { label: "Approved", colorClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  paid: { label: "Paid", colorClass: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800" },
  rejected: { label: "Rejected", colorClass: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" },
};

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; colorClass: string }> = {
  proposed: { label: "Awaiting Owner Approval", colorClass: "bg-primary/10 text-primary border-primary/20 dark:bg-primary/20 dark:text-primary-foreground dark:border-primary/30" },
  placed: { label: "Placed", colorClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
  confirmed: { label: "Confirmed", colorClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" },
  shipped: { label: "Shipped", colorClass: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800" },
  delivered: { label: "Delivered", colorClass: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800" },
  cancelled: { label: "Cancelled", colorClass: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
};
