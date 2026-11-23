const assert = require('assert');
const { maskPhoneNumber, normalizeIndianMobile } = require('../utils/smsPhoneUtils');

async function testFast2SmsRequest() {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.FAST2SMS_API_KEY;
    let request;
    process.env.FAST2SMS_API_KEY = 'test-api-key';
    global.fetch = async (url, options) => {
        request = { url: new URL(url), options };
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ return: true, request_id: 'request-1' })
        };
    };

    try {
        const { getSkipReason, sendFast2Sms } = require('../utils/fast2SmsService');
        const result = await sendFast2Sms('+91 98765 43210', 'Attendance notice');
        assert.strictEqual(result.providerMessageId, 'request-1');
        assert.strictEqual(request.url.origin + request.url.pathname, 'https://www.fast2sms.com/dev/bulkV2');
        assert.strictEqual(request.url.searchParams.get('route'), 'q');
        assert.strictEqual(request.url.searchParams.get('numbers'), '9876543210');
        assert.strictEqual(request.url.searchParams.get('message'), 'Attendance notice');
        assert.strictEqual(request.options.method, 'GET');
        assert.strictEqual(request.options.headers.authorization, 'test-api-key');
        assert.strictEqual(
            getSkipReason({ parentPhone: '9876543210', parentSmsOptOut: true }),
            'Parent opted out of attendance SMS'
        );

        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ return: false, message: ['Insufficient balance'] })
        });
        await assert.rejects(
            sendFast2Sms('9876543210', 'Attendance notice'),
            /Insufficient balance/
        );
    } finally {
        global.fetch = originalFetch;
        if (originalApiKey === undefined) delete process.env.FAST2SMS_API_KEY;
        else process.env.FAST2SMS_API_KEY = originalApiKey;
    }
}

async function testAttendanceNotificationProcessing() {
    const notificationPath = require.resolve('../models/ParentNotification');
    const attendancePath = require.resolve('../models/Attendance');
    const studentPath = require.resolve('../models/Student');
    const servicePath = require.resolve('../utils/fast2SmsService');
    const originals = {
        notification: require.cache[notificationPath],
        attendance: require.cache[attendancePath],
        student: require.cache[studentPath],
        service: require.cache[servicePath],
        fetch: global.fetch,
        apiKey: process.env.FAST2SMS_API_KEY
    };
    const writes = [];
    const createdEventKeys = new Set();
    const notifications = new Map();
    const notificationModel = {
        updateOne: async (filter, update, options) => {
            writes.push({ filter, update, options });
            if (options && options.upsert) {
                const exists = createdEventKeys.has(filter.eventKey);
                if (!exists) {
                    createdEventKeys.add(filter.eventKey);
                    notifications.set(filter.eventKey, update.$setOnInsert);
                }
                return { upsertedCount: exists ? 0 : 1 };
            }
            if (filter.eventKey && update.$set && notifications.has(filter.eventKey)) {
                notifications.set(filter.eventKey, {
                    ...notifications.get(filter.eventKey),
                    ...update.$set
                });
            }
            return { matchedCount: 1 };
        },
        findOne: eventFilter => ({
            select() { return this; },
            lean: async () => notifications.get(eventFilter.eventKey)
        })
    };
    const attendanceModel = {
        findById: () => ({
            select() { return this; },
            lean: async () => ({ status: 'absent' })
        })
    };
    const studentModel = {
        find: () => ({
            select() { return this; },
            lean: async () => [{
                studentId: 'CS001',
                studentName: 'Test Student',
                parentName: 'Test Parent',
                parentPhone: '+91 98765 43210',
                parentSmsOptOut: false
            }]
        })
    };

    process.env.FAST2SMS_API_KEY = 'test-api-key';
    global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ return: true, request_id: 'request-2' })
    });
    require.cache[notificationPath] = {
        id: notificationPath, filename: notificationPath, loaded: true, exports: notificationModel
    };
    require.cache[attendancePath] = {
        id: attendancePath, filename: attendancePath, loaded: true, exports: attendanceModel
    };
    require.cache[studentPath] = {
        id: studentPath, filename: studentPath, loaded: true, exports: studentModel
    };
    delete require.cache[servicePath];

    try {
        const { processAttendanceEvents } = require('../utils/fast2SmsService');
        const summary = await processAttendanceEvents([
            {
                eventType: 'absence',
                attendance: {
                    attendanceRecordId: 'attendance-1',
                    studentId: 'CS001',
                    studentName: 'Test Student',
                    status: 'absent',
                    date: '2026-02-01',
                    department: 'Computer Science',
                    program: 'UG',
                    year: '1',
                    classId: 'CS1'
                }
            },
            {
                eventType: 'absence',
                attendance: {
                    attendanceRecordId: 'attendance-2',
                    studentId: 'CS002',
                    status: 'present',
                    date: '2026-02-01',
                    department: 'Computer Science',
                    program: 'UG',
                    year: '1',
                    classId: 'CS1'
                }
            }
        ]);
        assert.strictEqual(summary.sent, 1);
        assert.strictEqual(summary.failed, 0);
        assert.strictEqual(writes.length, 2, 'Present students must not create SMS notifications');
        assert.strictEqual(writes[0].filter.eventKey, 'attendance-1:absence');
        assert.strictEqual(writes[0].update.$setOnInsert.status, 'pending');
        assert.strictEqual(writes[0].update.$setOnInsert.parentPhone, '919876543210');
        assert.strictEqual(notifications.get('attendance-1:absence').status, 'sent');

        const correction = await processAttendanceEvents([{
            eventType: 'correction',
            attendance: {
                attendanceRecordId: 'attendance-1',
                studentId: 'CS001'
            }
        }]);
        assert.strictEqual(correction.skipped, 1);
        assert.strictEqual(writes[2].filter.status, 'pending');
        assert.strictEqual(writes[2].update.$set.status, 'skipped');

        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ return: false, message: ['Test provider rejection'] })
        });
        const failed = await processAttendanceEvents([{
            eventType: 'absence',
            attendance: {
                attendanceRecordId: 'attendance-3',
                studentId: 'CS001',
                status: 'absent',
                date: '2026-02-01',
                department: 'Computer Science',
                program: 'UG',
                year: '1',
                classId: 'CS1'
            }
        }]);
        assert.strictEqual(failed.failed, 1);
        assert.strictEqual(notifications.get('attendance-3:absence').status, 'failed');
    } finally {
        if (originals.notification) require.cache[notificationPath] = originals.notification;
        else delete require.cache[notificationPath];
        if (originals.attendance) require.cache[attendancePath] = originals.attendance;
        else delete require.cache[attendancePath];
        if (originals.student) require.cache[studentPath] = originals.student;
        else delete require.cache[studentPath];
        if (originals.service) require.cache[servicePath] = originals.service;
        else delete require.cache[servicePath];
        global.fetch = originals.fetch;
        if (originals.apiKey === undefined) delete process.env.FAST2SMS_API_KEY;
        else process.env.FAST2SMS_API_KEY = originals.apiKey;
    }
}

async function run() {
    assert.strictEqual(normalizeIndianMobile('9876543210'), '919876543210');
    assert.strictEqual(normalizeIndianMobile('+91 98765-43210'), '919876543210');
    assert.strictEqual(normalizeIndianMobile('12345'), null);
    assert.strictEqual(maskPhoneNumber('919876543210'), '91******3210');

    await testFast2SmsRequest();
    await testAttendanceNotificationProcessing();
    console.log('Fast2SMS parent notification tests passed.');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
