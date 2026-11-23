const express = require('express');
const {
    listNotifications,
    retryNotificationHandler,
    getSmsStatus,
    sendTestSms
} = require('../controllers/parentNotificationController');
const { protect }      = require('../middleware/authMiddleware');
const { requireRole }  = require('../middleware/roleMiddleware');

const router = express.Router();

// All notification routes require admin authentication
router.use(protect, requireRole('admin'));

// Notification history
router.get('/', listNotifications);

// SMS gateway status and counts (no credentials in response)
router.get('/sms-status', getSmsStatus);

// Send a test SMS to verify connectivity — body: { phoneNumber: "91XXXXXXXXXX" }
router.post('/test-sms', sendTestSms);

// Retry a failed or pending notification
router.post('/:id/retry', retryNotificationHandler);

module.exports = router;
