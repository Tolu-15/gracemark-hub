import React from "react";
import NotAvailable from "@/components/shared/NotAvailable";
import { PAYMENTS_ENABLED } from "@/lib/features";

export default function Layout({ children }: { children: React.ReactNode }) {
  if (!PAYMENTS_ENABLED) {
    return <NotAvailable message="Online fee payment is not available at the moment." />;
  }
  return <>{children}</>;
}
