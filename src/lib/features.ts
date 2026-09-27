/**
 * Online fee payment and paid admissions are switched off for now. Flip by setting
 * NEXT_PUBLIC_PAYMENTS_ENABLED=true (the fee-lock by an admin keeps working either way).
 */
export const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";
