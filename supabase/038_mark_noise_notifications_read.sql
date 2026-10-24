-- One-off cleanup. The app no longer sends "attendance.edit" or "scores.edit_start" notifications
-- (they were ~60% of all notifications and were never read). Mark the existing unread ones as read
-- so admins' bell badges drop back to real items. Rows are kept for history. Safe to re-run.

UPDATE public.notifications
SET read_at = now()
WHERE read_at IS NULL
  AND type IN ('attendance.edit', 'scores.edit_start');
