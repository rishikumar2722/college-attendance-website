const Attendance = require('../models/Attendance');
const ParentNotification = require('../models/ParentNotification');
const Student = require('../models/Student');
const { normalizeIndianMobile } = require('./smsPhoneUtils');
const { sendAndroidSms } = require('./androidSmsService');

const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_FAILURE_LENGTH = 300;

const COLLEGE_NAME = 'Thanthai Hans Roever College';

/**
 * Returns 'android_gateway' or 'fast2sms' based on SMS_PROVIDER env var.
 * Defaults to 'android_gateway' when SMS_PROVIDER=android_gateway is set.
 * Falls back to fast2sms when FAST2SMS_API_KEY is set.
 * Returns null if neither is configured.
 */
function resolveSmsProvider() {
    const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
    if (provider === 'android_gateway') return 'android_gateway';
    if (provider === 'fast2sms') return 'fast2sms';
    // Auto-detect: prefer Android gateway if its URL is set, then Fast2SMS
    if (String(process.env.ANDROID_SMS_GATEWAY_URL || '').trim()) return 'android_gateway';
    if (String(process.env.FAST2SMS_API_KEY || '').trim()) return 'fast2sms';
    return null;
}

function buildMessage(studentId, attendanceDate) {
    const rollNumber = String(studentId || '').replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 20) || 'Student';
    // Keep old short format for Fast2SMS (character limit); Android Gateway uses full message.
    return `Attendance notice: ${rollNumber} marked ABSENT on ${attendanceDate}.`;
}

/**
 * Builds the full parent notification message for the Android SMS Gateway.
 * Uses the student's real name and date in readable format.
 */
function buildParentMessage(studentName, studentId, attendanceDate) {
    const name       = String(studentName || studentId || 'your child').trim();
    const rollNumber = String(studentId   || '').replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 20);
    // Format date from YYYY-MM-DD to DD/MM/YYYY
    let dateDisplay = attendanceDate;
    const parts = String(attendanceDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (parts) dateDisplay = `${parts[3]}/${parts[2]}/${parts[1]}`;
    return `Dear Parent, your child ${name}, Roll No: ${rollNumber}, was marked ABSENT today (${dateDisplay}) at ${COLLEGE_NAME}. Please contact the college for further information.`;
}

function getSkipReason(student) {
    if (!student) return 'Student record not found';
    if (student.parentSmsOptOut === true) return 'Parent opted out of attendance SMS';
    if (!student.parentPhone || !String(student.parentPhone).trim()) return 'Parent mobile number missing';
    if (!normalizeIndianMobile(student.parentPhone)) return 'Parent mobile number is invalid';
    return '';
}

function getProviderMessage(payload) {
    if (!payload || payload.message == null) return '';
    return (Array.isArray(payload.message) ? payload.message.join('; ') : String(payload.message))
        .trim()
        .slice(0, MAX_FAILURE_LENGTH);
}

async function sendFast2Sms(phoneNumber, message) {
    const apiKey = String(process.env.FAST2SMS_API_KEY || '').trim();
    if (!apiKey) throw new Error('FAST2SMS_API_KEY is not configured');

    const mobileNumber = normalizeIndianMobile(phoneNumber);
    if (!mobileNumber) throw new Error('Parent mobile number is invalid');

    const url = new URL(FAST2SMS_URL);
    url.searchParams.set('route', 'q');
    url.searchParams.set('message', message);
    url.searchParams.set('numbers', mobileNumber.slice(-10));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                authorization: apiKey,
                accept: 'application/json'
            },
            signal: controller.signal
        });
        const responseText = await response.text();
        let payload;
        try {
            payload = JSON.parse(responseText);
        } catch {
            throw new Error(`Fast2SMS returned an invalid response (HTTP ${response.status})`);
        }

        const providerMessage = getProviderMessage(payload);
        if (!response.ok) {
            throw new Error(`Fast2SMS request failed (HTTP ${response.status})${providerMessage ? `: ${providerMessage}` : ''}`);
        }
        if (payload.return !== true) {
            throw new Error(providerMessage || 'Fast2SMS rejected the request');
        }

        return {
            providerMessageId: typeof payload.request_id === 'string' ? payload.request_id : ''
        };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Dispatches one SMS through whichever provider is active.
 * Returns { providerMessageId: string }.
 * Throws on any failure.
 */
async function dispatchSms(phoneNumber, message, studentName, studentId, attendanceDate) {
    const provider = resolveSmsProvider();

    if (provider === 'android_gateway') {
        // Use the richer parent-friendly message for the Android Gateway
        const fullMessage = buildParentMessage(studentName, studentId, attendanceDate);
        return await sendAndroidSms(phoneNumber, fullMessage);
    }

    if (provider === 'fast2sms') {
        return await sendFast2Sms(phoneNumber, message);
    }

    throw new Error(
        'No SMS provider is configured. Set SMS_PROVIDER=android_gateway and ' +
        'ANDROID_SMS_GATEWAY_URL in your .env file.'
    );
}

/**
 * Builds the action name stored in statusHistory based on the active provider.
 */
function getProviderAction(status) {
    const provider = resolveSmsProvider();
    if (provider === 'android_gateway') {
        return status === 'sent' ? 'android_gateway_accepted' : 'android_gateway_failed';
    }
    return status === 'sent' ? 'fast2sms_accepted' : 'fast2sms_failed';
}

async function saveNotificationStatus(eventKey, status, reason, providerMessageId, statusFilter = 'pending') {
    const now = new Date();
    const update = {
        $set: {
            status,
            failureReason: reason,
            providerMessageId: providerMessageId || '',
            sentAt: status === 'sent' ? now : null
        },
        $push: {
            statusHistory: {
                status,
                action: getProviderAction(status),
                reason,
                at: now
            }
        }
    };
    if (status !== 'skipped') update.$inc = { attempts: 1 };

    await ParentNotification.updateOne(
        { eventKey, status: statusFilter },
        update
    );
}

async function createAbsenceNotification(attendance, student) {
    const attendanceRecordId = attendance.attendanceRecordId || attendance._id;
    if (!attendanceRecordId) throw new Error('Saved attendance record ID is required for SMS notification');

    const studentId = String(attendance.studentId || '').trim().toUpperCase();
    const reason = getSkipReason(student);
    const eventKey = `${attendanceRecordId}:absence`;
    const status = reason ? 'skipped' : 'pending';
    const now = new Date();
    const studentName = (student && student.studentName) || attendance.studentName || '';
    const fields = {
        eventKey,
        eventType: 'absence',
        attendanceRecordId,
        studentId,
        studentName,
        parentName: (student && student.parentName) || '',
        parentPhone: reason ? '' : normalizeIndianMobile(student.parentPhone),
        department: attendance.department,
        program: attendance.program,
        year: String(attendance.year),
        classId: attendance.classId,
        attendanceDate: attendance.date,
        status,
        failureReason: reason,
        statusHistory: [{
            status,
            action: reason ? 'skipped' : 'dispatching',
            reason,
            at: now
        }]
    };

    let inserted = false;
    try {
        const result = await ParentNotification.updateOne(
            { eventKey },
            { $setOnInsert: fields },
            { upsert: true }
        );
        inserted = result.upsertedCount > 0;
    } catch (error) {
        if (error.code !== 11000) throw error;
    }

    if (!inserted) {
        const existing = await ParentNotification.findOne({ eventKey }).select('status').lean();
        if (!existing) throw new Error('Unable to retrieve the existing attendance notification');
        return { status: existing.status, reason: 'Attendance notification was already processed' };
    }
    if (reason) return { status: 'skipped', reason };

    const currentAttendance = await Attendance.findById(attendanceRecordId).select('status').lean();
    if (!currentAttendance || currentAttendance.status !== 'absent') {
        const correctionReason = 'Attendance is no longer absent; SMS was not sent';
        await saveNotificationStatus(eventKey, 'skipped', correctionReason, '');
        return { status: 'skipped', reason: correctionReason };
    }

    let result;
    try {
        result = await dispatchSms(
            fields.parentPhone,
            buildMessage(studentId, attendance.date),
            studentName,
            studentId,
            attendance.date
        );
    } catch (error) {
        const failureReason = String(error.message || 'SMS dispatch failed').slice(0, MAX_FAILURE_LENGTH);
        await saveNotificationStatus(eventKey, 'failed', failureReason, '');
        return { status: 'failed', reason: failureReason };
    }
    await saveNotificationStatus(eventKey, 'sent', '', result.providerMessageId);
    return { status: 'sent', reason: '' };
}

/**
 * Retries a single failed or pending notification by its MongoDB _id.
 * Never re-marks a successful send as sent again (idempotent guard).
 * Returns { status, reason }.
 */
async function retryNotification(notificationId) {
    const notification = await ParentNotification.findById(notificationId).lean();
    if (!notification) {
        return { status: 'error', reason: 'Notification record not found' };
    }

    if (notification.status === 'sent' || notification.status === 'delivered') {
        return { status: notification.status, reason: 'Notification was already sent successfully' };
    }

    if (notification.status === 'skipped') {
        return { status: 'skipped', reason: notification.failureReason || 'Notification was skipped and cannot be retried' };
    }

    // Verify the original attendance record is still absent
    if (notification.attendanceRecordId) {
        const currentAttendance = await Attendance.findById(notification.attendanceRecordId).select('status').lean();
        if (!currentAttendance) {
            return { status: 'error', reason: 'Original attendance record no longer exists' };
        }
        if (currentAttendance.status !== 'absent') {
            const reason = 'Attendance is no longer absent; retry was cancelled';
            await ParentNotification.updateOne(
                { _id: notificationId },
                {
                    $set: { status: 'skipped', failureReason: reason },
                    $push: { statusHistory: { status: 'skipped', action: 'retry_cancelled', reason, at: new Date() } }
                }
            );
            return { status: 'skipped', reason };
        }
    }

    // Check parent phone is still valid
    if (!notification.parentPhone) {
        // Try to fetch current phone from student record
        const student = await Student.findOne({
            studentId: notification.studentId,
            department: notification.department,
            year: String(notification.year),
            program: notification.program
        }).select('parentPhone parentSmsOptOut studentName parentName').lean();

        const skipReason = getSkipReason(student);
        if (skipReason) {
            const reason = `Retry skipped: ${skipReason}`;
            await ParentNotification.updateOne(
                { _id: notificationId },
                {
                    $set: { status: 'skipped', failureReason: reason },
                    $push: { statusHistory: { status: 'skipped', action: 'retry_skipped', reason, at: new Date() } },
                    $inc: { attempts: 1 }
                }
            );
            return { status: 'skipped', reason };
        }

        // Update stored phone before retrying
        const normalised = normalizeIndianMobile(student.parentPhone);
        await ParentNotification.updateOne({ _id: notificationId }, { $set: { parentPhone: normalised } });
        notification.parentPhone = normalised;
        if (student.studentName && !notification.studentName) notification.studentName = student.studentName;
    }

    // Set status to pending so saveNotificationStatus can find it
    await ParentNotification.updateOne(
        { _id: notificationId },
        {
            $set: { status: 'pending' },
            $push: {
                statusHistory: {
                    status: 'pending',
                    action: 'retry_dispatching',
                    reason: '',
                    at: new Date()
                }
            }
        }
    );

    let result;
    try {
        result = await dispatchSms(
            notification.parentPhone,
            buildMessage(notification.studentId, notification.attendanceDate),
            notification.studentName,
            notification.studentId,
            notification.attendanceDate
        );
    } catch (error) {
        const failureReason = String(error.message || 'SMS retry failed').slice(0, MAX_FAILURE_LENGTH);
        await saveNotificationStatus(notification.eventKey, 'failed', failureReason, '', 'pending');
        return { status: 'failed', reason: failureReason };
    }

    await saveNotificationStatus(notification.eventKey, 'sent', '', result.providerMessageId, 'pending');
    return { status: 'sent', reason: '' };
}

async function processAttendanceEvents(events) {
    const absences = events.filter(event =>
        event.eventType === 'absence' &&
        (!event.attendance.status || event.attendance.status === 'absent')
    );
    const corrections = events.filter(event => event.eventType === 'correction');
    const studentIds = [...new Set(absences.map(event =>
        String(event.attendance.studentId).trim().toUpperCase()
    ))];
    const scope = absences[0] && absences[0].attendance;
    const students = scope && studentIds.length
        ? await Student.find({
            studentId: { $in: studentIds },
            department: scope.department,
            year: String(scope.year),
            program: scope.program
        }).select('studentId studentName parentName parentPhone parentSmsOptOut').lean()
        : [];
    const studentsById = new Map(students.map(student => [student.studentId, student]));

    const summary = {
        processed: events.length,
        sent: 0,
        queued: 0,
        failed: 0,
        skipped: 0,
        details: []
    };

    for (const event of absences) {
        const studentId = String(event.attendance.studentId).trim().toUpperCase();
        const result = await createAbsenceNotification(
            event.attendance,
            studentsById.get(studentId)
        );
        if (result.status === 'sent') summary.sent++;
        else if (result.status === 'pending') summary.queued++;
        else if (result.status === 'failed') summary.failed++;
        else if (result.status === 'skipped') summary.skipped++;
        summary.details.push({ studentId, status: result.status, reason: result.reason });
    }

    for (const event of corrections) {
        const attendanceRecordId = event.attendance.attendanceRecordId || event.attendance._id;
        if (attendanceRecordId) {
            const reason = 'Attendance was updated to present before SMS dispatch';
            await ParentNotification.updateOne(
                {
                    attendanceRecordId,
                    eventType: 'absence',
                    status: 'pending'
                },
                {
                    $set: { status: 'skipped', failureReason: reason },
                    $push: {
                        statusHistory: {
                            status: 'skipped',
                            action: 'attendance_corrected',
                            reason,
                            at: new Date()
                        }
                    }
                }
            );
        }
        summary.skipped++;
        summary.details.push({
            studentId: String(event.attendance.studentId || '').trim().toUpperCase(),
            status: 'skipped',
            reason: 'Attendance was updated to present'
        });
    }

    return summary;
}

module.exports = {
    buildMessage,
    buildParentMessage,
    getSkipReason,
    resolveSmsProvider,
    processAttendanceEvents,
    retryNotification,
    sendFast2Sms
};