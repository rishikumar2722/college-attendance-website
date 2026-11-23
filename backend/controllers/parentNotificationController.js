const ParentNotification = require('../models/ParentNotification');
const { maskPhoneNumber } = require('../utils/smsPhoneUtils');
const Student = require('../models/Student');
const { retryNotification, resolveSmsProvider } = require('../utils/fast2SmsService');
const { sendAndroidSms, checkGatewayHealth, getConfigError } = require('../utils/androidSmsService');

const VALID_STATUSES = ['pending', 'sent', 'delivered', 'failed', 'skipped'];
const ALLOWED_CLASSES = ['CS1', 'CS2', 'CS3', 'PGCS1', 'PGCS2'];

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function listNotifications(req, res) {
    try {
        const { dateFrom, dateTo, classId, department, status } = req.query;
        if ((dateFrom && !isValidDate(dateFrom)) || (dateTo && !isValidDate(dateTo))) {
            return res.status(400).json({ success: false, message: 'Date filters must use a valid YYYY-MM-DD date' });
        }
        if (dateFrom && dateTo && dateFrom > dateTo) {
            return res.status(400).json({ success: false, message: 'Start date must be on or before end date' });
        }
        if (department && department !== 'Computer Science') {
            return res.status(400).json({ success: false, message: 'Notification history is limited to Computer Science' });
        }
        if (classId && !ALLOWED_CLASSES.includes(String(classId).trim().toUpperCase())) {
            return res.status(400).json({ success: false, message: 'Invalid Computer Science class filter' });
        }
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid notification status filter' });
        }

        const filter = {
            department: 'Computer Science',
            program: { $in: ['UG', 'PG'] }
        };
        if (classId) filter.classId = String(classId).trim().toUpperCase();
        if (status) filter.status = status;
        if (dateFrom || dateTo) {
            filter.attendanceDate = {};
            if (dateFrom) filter.attendanceDate.$gte = dateFrom;
            if (dateTo) filter.attendanceDate.$lte = dateTo;
        }

        const notifications = await ParentNotification.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .select('-parentName -eventKey')
            .lean();
        const students = await Student.find({
            studentId: { $in: [...new Set(notifications.map(notification => notification.studentId))] },
            department: 'Computer Science',
            program: { $in: ['UG', 'PG'] }
        }).select('studentId department program year parentPhone').lean();
        const currentPhonesByStudent = new Map(students.map(student => [
            `${student.department}:${student.program}:${student.year}:${student.studentId}`,
            student.parentPhone
        ]));

        return res.status(200).json({
            success: true,
            notifications: notifications.map(({ parentPhone, ...notification }) => {
                const currentParentPhone = currentPhonesByStudent.get(
                    `${notification.department}:${notification.program}:${notification.year}:${notification.studentId}`
                );
                const legacyConsentSkip = notification.status === 'skipped' &&
                    notification.failureReason === 'SMS consent has not been provided';
                const legacyAuthorizationSkip = notification.status === 'skipped' &&
                    notification.failureReason === 'Institutional parent SMS authorization is not enabled';
                const legacyMissingPhone = [
                    'Parent mobile number is missing',
                    'Parent mobile number missing'
                ].includes(notification.failureReason);
                const statusHistory = notification.statusHistory && notification.statusHistory.length
                    ? notification.statusHistory
                    : legacyConsentSkip || legacyAuthorizationSkip || legacyMissingPhone
                        ? [{
                            status: 'skipped',
                            action: 'legacy_skip',
                            reason: notification.failureReason,
                            at: notification.createdAt
                        }]
                        : [];
                return {
                    ...notification,
                    failureReason: legacyConsentSkip
                        ? 'Previously skipped under the legacy consent policy; it will not be sent automatically'
                        : legacyAuthorizationSkip
                            ? 'Not sent under the previous authorization setting; it will not be sent automatically'
                            : legacyMissingPhone
                                ? 'Parent mobile number missing'
                                : notification.failureReason,
                    statusHistory,
                    parentPhoneMasked: maskPhoneNumber(parentPhone || currentParentPhone),
                    canRetry: ['failed', 'pending'].includes(notification.status)
                };
            })
        });
    } catch (error) {
        console.error('listNotifications error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve notification history' });
    }
}

/**
 * @route  POST /api/notifications/:id/retry
 * @access Admin
 */
async function retryNotificationHandler(req, res) {
    try {
        const { id } = req.params;
        if (!id || !/^[a-f\d]{24}$/i.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid notification ID' });
        }

        const result = await retryNotification(id);

        if (result.status === 'error') {
            return res.status(404).json({ success: false, message: result.reason });
        }

        const success = result.status === 'sent' || result.status === 'delivered';
        return res.status(success ? 200 : 422).json({
            success,
            message: success
                ? 'SMS sent successfully'
                : `Retry completed with status: ${result.status}${result.reason ? ` — ${result.reason}` : ''}`,
            status: result.status,
            reason: result.reason || ''
        });
    } catch (error) {
        console.error('retryNotificationHandler error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retry notification' });
    }
}

/**
 * @route  GET /api/notifications/sms-status
 * @access Admin
 * Returns gateway connectivity status and notification counts (no credentials exposed).
 */
async function getSmsStatus(req, res) {
    try {
        const provider = resolveSmsProvider();

        // Gateway health check
        let gatewayOnline = false;
        let gatewayDetail = '';
        let configError   = '';

        if (provider === 'android_gateway') {
            configError = getConfigError();
            if (!configError) {
                const health = await checkGatewayHealth();
                gatewayOnline  = health.online;
                gatewayDetail  = health.detail;
            } else {
                gatewayDetail = configError;
            }
        } else if (provider === 'fast2sms') {
            const apiKey = String(process.env.FAST2SMS_API_KEY || '').trim();
            gatewayOnline = !!apiKey;
            gatewayDetail = apiKey ? 'Fast2SMS API key is configured' : 'FAST2SMS_API_KEY is not set';
        } else {
            gatewayDetail = 'No SMS provider is configured';
        }

        // Aggregate notification counts
        const counts = await ParentNotification.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);
        const countMap = {};
        counts.forEach(({ _id, count }) => { countMap[_id] = count; });

        const gatewayUrl = provider === 'android_gateway'
            ? String(process.env.ANDROID_SMS_GATEWAY_URL || '').trim()
            : '';

        return res.status(200).json({
            success: true,
            provider:      provider || 'none',
            gatewayOnline,
            gatewayDetail,
            configError,
            gatewayUrl,         // safe to expose — not a credential
            counts: {
                sent:    countMap.sent      || 0,
                failed:  countMap.failed    || 0,
                pending: countMap.pending   || 0,
                skipped: countMap.skipped   || 0,
                delivered: countMap.delivered || 0
            }
        });
    } catch (error) {
        console.error('getSmsStatus error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve SMS status' });
    }
}

/**
 * @route  POST /api/notifications/test-sms
 * @access Admin
 * Sends a test SMS to a specified phone number.
 * Body: { phoneNumber: "91XXXXXXXXXX" }
 * Never logs or returns the gateway credentials.
 */
async function sendTestSms(req, res) {
    try {
        const rawPhone = String(req.body.phoneNumber || '').trim();
        if (!rawPhone) {
            return res.status(400).json({ success: false, message: 'phoneNumber is required' });
        }

        const provider = resolveSmsProvider();
        if (!provider || provider === 'none') {
            return res.status(503).json({
                success: false,
                message: 'No SMS provider is configured. Add ANDROID_SMS_GATEWAY_URL to .env'
            });
        }

        if (provider === 'android_gateway') {
            const configErr = getConfigError();
            if (configErr) {
                return res.status(503).json({ success: false, message: configErr });
            }
            const testMessage = `[Test] SMS Gateway connection verified at ${new Date().toLocaleString('en-IN')}. Thanthai Hans Roever College Attendance System.`;
            const result = await sendAndroidSms(rawPhone, testMessage);
            return res.status(200).json({
                success: true,
                message: 'Test SMS accepted by Android SMS Gateway',
                providerMessageId: result.providerMessageId
            });
        }

        // fast2sms fallback test
        const { sendFast2Sms, buildMessage } = require('../utils/fast2SmsService');
        const result = await sendFast2Sms(rawPhone, `[Test] College Attendance System SMS gateway test at ${new Date().toLocaleString('en-IN')}`);
        return res.status(200).json({
            success: true,
            message: 'Test SMS accepted by Fast2SMS',
            providerMessageId: result.providerMessageId
        });
    } catch (error) {
        console.error('sendTestSms error:', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Test SMS failed'
        });
    }
}

module.exports = {
    listNotifications,
    retryNotificationHandler,
    getSmsStatus,
    sendTestSms
};
