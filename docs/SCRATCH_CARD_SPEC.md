# GMA Result Hub — Scratch Card System (Design Spec)

Status: **BUILT on branch `nextjs-migration`, not yet applied to production.** Apply
`supabase/039_scratch_cards.sql` then `040_gate_terminal_result_snapshots.sql`, then deploy.
Scope: gate the **Terminal Result (TR) only**. Progress reports PR1–PR3 stay free.

Decisions made while building:
- Parents/students use the child's own login (no public result checker).
- Confirm-before-view: **yes** ("You have N views left. Use 1?").
- Grace window: **off** (every open counts). One constant, `GRACE_MINUTES` in `src/lib/scratchCards.ts`.
- Offline issuers: `toluwanimibabalola2707@gmail.com` and `gracemarkacademy@gmail.com`
  (override with env `SCRATCH_CARD_ISSUER_EMAILS`). Other admins can view sales only.
- Online card sales have their own switch: `SCRATCH_CARD_ONLINE_ENABLED=true` + `PAYSTACK_SECRET_KEY`
  (server-side env; restart after changing). It is independent of `NEXT_PUBLIC_PAYMENTS_ENABLED`, so
  school-fee payments and the fee-based portal lock stay off. With it off, only office-issued cards
  work. No Paystack split payment yet.
- Offline/complimentary cards start `issued` and become `active` when the parent enters the PIN;
  online cards are `active` as soon as Paystack confirms the payment.

---

## 1. Summary

A parent or student logs in to the child's account and taps **View Result** for a
published terminal result. If no active card exists for that **session + term**, they
see **Purchase scratch card** (pay online via Paystack, or contact the school). Once a
card is active, they get **5 successful views** of that term's TR, printing included.
When the 5 views are used up, a new card is needed. Each new term, and each new
session, needs its own card.

Price: **₦1,000**. Paystack fees are absorbed by the developer. An admin can issue a
**free card** (staff children, hardship) and can revoke a card.

---

## 2. Key rules (agreed)

| Rule | Decision |
|---|---|
| What is gated | Terminal Result only; PR1–PR3 free |
| Who logs in | Parent/student, into the child's own account |
| Card binding | One student, one `academic_session`, one `term_code` |
| Allowance | 5 successful views per card; printing included |
| What spends a view | One successful open of the TR |
| What does NOT spend a view | Wrong PIN, network error, unpublished result, locked/exhausted card |
| Online purchase | Paystack ₦1,000; card auto-attaches to the student on verified payment |
| Offline purchase | Named admin records ₦1,000 cash and issues a PIN |
| No card | TR not viewable (by design) |
| Free access | Admin issues a complimentary card; logged with who issued it |
| Enforcement | Server-side only; direct DB reads of TR blocked for students |

---

## 3. Open decisions (need your answer before build)

1. **Grace window** — should a refresh/print within ~10 min of a counted view be
   free? *Recommended: yes* (prevents accidental double-charges). Your stated rule is
   "every open counts", so this is only added if you say so.
2. **Confirm-before-view** — show "You have N views left. Use 1?" before opening.
   *Recommended: yes.*
3. **Offline issuers** — all admins, or 1–2 named people? *Recommended: named only.*
4. **Paystack account & split** — whose account receives funds, and do we use
   Paystack split payments so the school's share is paid directly? *Needs the
   management agreement.*

---

## 4. Data model (new tables)

### `scratch_cards`
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| pin_hash | text | hash only; never store the raw PIN |
| serial | text unique | human-friendly reference printed on the card |
| student_id | uuid fk → students | bound to one student |
| academic_session_id | uuid fk → academic_sessions | |
| term_code | term_code_enum | term1/term2/term3 |
| report_type | text | fixed `TR` for now |
| views_allowed | int default 5 | |
| views_used | int default 0 | |
| source | text | `online` \| `offline` \| `complimentary` |
| status | text | `active` \| `exhausted` \| `revoked` |
| payment_transaction_id | uuid fk nullable | online cards |
| issued_by | uuid nullable | admin for offline/complimentary |
| created_at / updated_at | timestamptz | |

Unique guard: at most one **active** card per (student, session, term) to avoid
double-selling. A fresh card after exhaustion is allowed.

### `scratch_card_views` (audit of each spend)
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| card_id | uuid fk → scratch_cards | |
| viewed_by_auth_id | uuid | who opened it |
| viewed_at | timestamptz | |
| counted | boolean | false when inside a grace window |

RLS: both tables are service-role only (no browser policies), like the timetable and
announcement tables. All access goes through server routes.

---

## 5. Flows

### 5.1 View a terminal result
1. Parent opens TR for a published term.
2. Server route checks for an `active` card for (student, session, term).
3. No card → respond "needs card" → UI shows **Purchase scratch card**.
4. Card with views left → (optional confirm) → server increments `views_used`,
   writes a `scratch_card_views` row, returns the report. At 5/5 the card flips to
   `exhausted`.
5. Grace window (if enabled): a repeat open by the same account within N minutes
   returns the report with `counted = false`.

### 5.2 Online purchase (Paystack)
1. Parent clicks **Pay online**, pays ₦1,000 (inline Paystack).
2. Paystack redirect/callback → **server verifies** the reference with Paystack's API.
3. On verified success → create the card, attach to the student, show the PIN/receipt.
4. **Idempotency:** the Paystack reference is unique; a duplicate callback never
   creates a second card.
5. **Recovery:** because the card is attached to the student's account, a parent who
   closed the browser sees it active on next login; a "recover my payment" action
   re-verifies the reference.

### 5.3 Offline purchase
1. Parent pays cash; a named admin records it and issues a PIN.
2. Same tables and validation as online, so no duplicate active card can exist.

### 5.4 Admin free card / revoke
- Issue `complimentary` card to a student (logged with `issued_by`).
- Revoke sets `status = revoked`; the next view attempt is refused.

---

## 6. Security

- PIN: long, random, stored as a hash; compared server-side.
- Wrong-PIN rate limit per account/IP with short lockout (separate from the 5 views).
- TR fetch only via a server route that checks the card and spends a view; students
  cannot read `result_snapshots` TR rows directly (RLS).
- Every purchase, view, revoke and free-issue written to `audit_logs`.
- Paystack secret stored with the existing encrypted-gateway mechanism.

---

## 7. Reused vs. new

- **Reuse:** `result_snapshots` (TR already tagged), payment tables, encrypted gateway
  secret, `audit_logs`, student/session/term tables.
- **New:** the two card tables, buy/recover/view server routes, parent purchase & PIN
  screens, admin card dashboard, Paystack verify route (if not already present).

---

## 8. Build order (after approval)

1. Tables + RLS + server-side view enforcement.
2. Parent "needs card / enter PIN / N views left" screens.
3. Paystack online purchase + verify + recovery.
4. Admin dashboard (sales, issue, revoke, revenue by term/session).
5. Test in Paystack **test mode** before any real money.

---

## 9. Outside the code (before launch)

- Written agreement with management: revenue split, Paystack account owner, who
  handles complaints.
- Verified Paystack business account; decide on split payments.
- Announce price, how to buy, and deadline to parents **before** the TR is published.
- Data-protection note on the purchase screen (children's records).
