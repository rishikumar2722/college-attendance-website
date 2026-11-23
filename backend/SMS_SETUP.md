# Fast2SMS attendance notifications

The backend sends a Quick SMS through Fast2SMS after an absent attendance record is saved. Present attendance does not trigger a message, and correcting an absence to present marks any still-pending notification as skipped. Notifications are recorded in MongoDB and shown in the admin notification history.

## Setup

1. Create a Fast2SMS API key in the Fast2SMS dashboard.
2. Set `FAST2SMS_API_KEY` in `backend/.env`. Keep this secret out of frontend code, source control, and screenshots.
3. Restart the backend and test with an authorized parent number. The backend calls `https://www.fast2sms.com/dev/bulkV2` using the Quick SMS route (`q`).
4. Confirm the notification history reports `sent` or `failed`. A successful API response means Fast2SMS accepted the request; it does not confirm final carrier delivery.

The message includes the student's roll number and attendance date. Missing or invalid parent numbers and parent opt-outs are recorded as skipped without calling Fast2SMS. API errors are recorded as failed; they are not automatically retried, to avoid duplicate SMS sends.

Run focused backend checks with `node backend/scripts/test-parent-notifications.js` from the repository root.
