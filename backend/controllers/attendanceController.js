const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { processAttendanceEvents } = require('../utils/parentNotificationService');

// Hours (formerly periods) allowed for attendance entries
const VALID_HOURS = [1, 2, 3, 4, 5];
const VALID_PERIODS = VALID_HOURS; // Alias for compatibility

function isValidAttendanceDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
}

/**
 * Normalise an optional period value from a request.
 * Returns a valid period number (1-5) or null for legacy whole-day records.
 */
function normalisePeriod(raw) {
    if (raw === null || raw === undefined || raw === '' || raw === 'null') return null;
    const n = parseInt(raw, 10);
    return VALID_PERIODS.includes(n) ? n : null;
}

async function notifyAttendanceEvents(events) {
    if (events.length === 0) return { processed: 0, failed: 0, skipped: 0 };
    try {
        return await processAttendanceEvents(events);
    } catch (error) {
        console.error('Parent notification processing failed after attendance was saved:', error);
        return {
            processed: 0,
            failed: 0,
            skipped: 0,
            warning: 'Attendance was saved, but parent notifications could not be processed.'
        };
    }
}

/**
 * @desc    Get attendance records for a specific date and class
 * @route   GET /api/attendance
 * @access  Private
 */
const getAttendance = async (req, res) => {
    try {
        const { date, department, year, program, classId, period } = req.query;

        if (!isValidAttendanceDate(date)) {
            return res.status(400).json({
                success: false,
                message: 'Attendance date must be a valid YYYY-MM-DD date'
            });
        }

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || req.user.department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram;
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const filter = {
            date: date.trim(),
            department: targetDept,
            year: targetYear
        };

        if (targetProgram) {
            filter.program = targetProgram;
        }

        if (req.user.role === 'staff' && req.user.classId) {
            filter.classId = req.user.classId;
        } else if (classId) {
            filter.classId = String(classId).trim().toUpperCase();
        }

        // Period filter: if supplied, filter to that period; otherwise return all periods
        const targetPeriod = normalisePeriod(period);
        if (targetPeriod !== null) {
            filter.period = targetPeriod;
        }

        const records = await Attendance.find(filter);

        // If no period filter was given, also report which periods have been submitted
        let submittedPeriods = [];
        if (targetPeriod === null) {
            const periodAgg = await Attendance.aggregate([
                { $match: { ...filter, period: { $in: VALID_PERIODS } } },
                { $group: { _id: '$period', present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } }, absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } } } },
                { $sort: { _id: 1 } }
            ]);
            submittedPeriods = periodAgg.map(p => ({ period: p._id, present: p.present, absent: p.absent }));
        }

        res.status(200).json({
            success: true,
            date,
            department: targetDept,
            year: targetYear,
            program: targetProgram || 'UG',
            classId: filter.classId,
            period: targetPeriod,
            count: records.length,
            records,
            submittedPeriods
        });
    } catch (error) {
        console.error('getAttendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve attendance records',
            error: error.message
        });
    }
};

/**
 * @desc    Mark or update attendance (batch or individual)
 * @route   POST /api/attendance/mark
 * @access  Private
 */
const markAttendance = async (req, res) => {
    try {
        const { date, department, year, program, classId, records, studentId, status, period } = req.body;

        if (!isValidAttendanceDate(date)) {
            return res.status(400).json({
                success: false,
                message: 'Attendance date must be a valid YYYY-MM-DD date'
            });
        }

        // Normalise period: 1-5 for period records, null for legacy whole-day
        const targetPeriod = normalisePeriod(period);

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || req.user.department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const targetClassId = classId || (req.user.role === 'staff' && req.user.classId) || (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`);
        const sfx = targetYear === '1' ? '1st' : targetYear === '2' ? '2nd' : targetYear === '3' ? '3rd' : `${targetYear}th`;
        const academicYear = `${sfx} Year`;

        // Case A: Batch save (array of records)
        if (Array.isArray(records)) {
            const submittedRecords = records.map(rec => {
                const sId = String(rec.studentId || rec.id || '').trim().toUpperCase();
                const sStatus = rec.status === 'absent' ? 'absent' : 'present';
                return {
                    studentId: sId,
                    studentName: rec.studentName || rec.name || '',
                    status: sStatus
                };
            }).filter(record => record.studentId);

            const studentIds = [...new Set(submittedRecords.map(record => record.studentId))];

            // Build the filter for checking existing records (period-aware)
            const existingFilter = {
                studentId: { $in: studentIds },
                date: date.trim(),
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                period: targetPeriod   // null for legacy, 1-5 for period records
            };

            const previousRecords = studentIds.length
                ? await Attendance.find(existingFilter).select('_id studentId status').lean()
                : [];
            const previousStatusById = new Map(previousRecords.map(record => [record.studentId, record.status]));

            const bulkOps = submittedRecords.map(rec => {
                return {
                    updateOne: {
                        filter: {
                            studentId: rec.studentId,
                            date: date.trim(),
                            department: targetDept,
                            year: targetYear,
                            program: targetProgram,
                            period: targetPeriod
                        },
                        update: {
                            $set: {
                                status: rec.status,
                                studentName: rec.studentName,
                                program: targetProgram,
                                academicYear: academicYear,
                                classId: targetClassId,
                                period: targetPeriod,
                                recordedBy: req.user._id
                            }
                        },
                        upsert: true
                    }
                };
            });

            if (bulkOps.length > 0) {
                await Attendance.bulkWrite(bulkOps);
            }

            const savedRecords = studentIds.length
                ? await Attendance.find(existingFilter).select('_id studentId status').lean()
                : [];
            const savedRecordByStudentId = new Map(savedRecords.map(record => [record.studentId, record]));

            // Only trigger absence SMS notifications for Period 1 (or legacy records)
            // to avoid sending multiple SMS per day for the same absence
            const shouldNotify = targetPeriod === null || targetPeriod === 1;
            const notificationEvents = shouldNotify ? submittedRecords.flatMap(record => {
                const savedRecord = savedRecordByStudentId.get(record.studentId);
                if (!savedRecord) return [];
                const attendanceRecord = {
                    ...record,
                    attendanceRecordId: savedRecord._id,
                    date: date.trim(),
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram,
                    classId: targetClassId
                };
                if (record.status === 'absent') {
                    return [{ eventType: 'absence', attendance: attendanceRecord }];
                }
                if (previousStatusById.get(record.studentId) === 'absent') {
                    return [{ eventType: 'correction', attendance: attendanceRecord }];
                }
                return [];
            }) : [];
            const notificationSummary = await notifyAttendanceEvents(notificationEvents);

            const periodLabel = targetPeriod ? `Period ${targetPeriod}` : 'Daily';
            return res.status(200).json({
                success: true,
                message: `Attendance saved for ${bulkOps.length} students on ${date} — ${periodLabel} (${targetProgram} ${academicYear})`,
                date,
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                classId: targetClassId,
                period: targetPeriod,
                notificationSummary
            });
        }

        // Case B: Single student mark/toggle
        if (studentId && status) {
            const normId = String(studentId).trim().toUpperCase();
            const normStatus = status === 'absent' ? 'absent' : 'present';
            const attendanceFilter = {
                studentId: normId,
                date: date.trim(),
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                period: targetPeriod
            };
            const previousRecord = await Attendance.findOne(attendanceFilter).select('status').lean();

            const record = await Attendance.findOneAndUpdate(
                attendanceFilter,
                {
                    status: normStatus,
                    program: targetProgram,
                    academicYear: academicYear,
                    classId: targetClassId,
                    period: targetPeriod,
                    recordedBy: req.user._id
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            const notificationEvents = [];
            const shouldNotify = targetPeriod === null || targetPeriod === 1;
            if (shouldNotify) {
                const attendanceRecord = {
                    attendanceRecordId: record._id,
                    studentId: normId,
                    studentName: record.studentName || '',
                    date: date.trim(),
                    status: normStatus,
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram,
                    classId: targetClassId
                };
                if (normStatus === 'absent') {
                    notificationEvents.push({ eventType: 'absence', attendance: attendanceRecord });
                } else if (previousRecord && previousRecord.status === 'absent') {
                    notificationEvents.push({ eventType: 'correction', attendance: attendanceRecord });
                }
            }
            const notificationSummary = await notifyAttendanceEvents(notificationEvents);

            const periodLabel = targetPeriod ? `Period ${targetPeriod}` : 'Daily';
            return res.status(200).json({
                success: true,
                message: `Attendance updated for ${normId}: ${normStatus} (${periodLabel})`,
                record,
                period: targetPeriod,
                notificationSummary
            });
        }

        return res.status(400).json({
            success: false,
            message: 'Provide either records array or studentId and status'
        });
    } catch (error) {
        console.error('markAttendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record attendance',
            error: error.message
        });
    }
};

/**
 * @desc    Upload Excel with student details and attendance
 * @route   POST /api/attendance/upload
 * @access  Private (staff only)
 */
const uploadExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No Excel file uploaded' });
        }
        const { department, year, program } = req.body;
        if (!department || !year) {
            return res.status(400).json({ success: false, message: 'Department and year are required' });
        }

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        }

        const sfx = year === '1' ? '1st' : year === '2' ? '2nd' : year === '3' ? '3rd' : `${year}th`;
        const academicYear = `${sfx} Year`;
        const targetClassId = targetProgram === 'PG' ? `PGCS${year}` : `CS${year}`;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const sheet = workbook.worksheets[0];
        const rows = sheet.getRows(2, sheet.rowCount - 1) || [];
        let insertedStudents = 0;
        let updatedStudents = 0;
        let insertedAttendance = 0;

        for (const row of rows) {
            if (!row) continue;
            const values = row.values.slice(1);
            const id = String(values[0] || '').trim();
            const name = String(values[1] || '').trim();
            const dateVal = values[2];
            const statusRaw = String(values[3] || '').trim().toLowerCase();
            const notes = String(values[4] || '').trim();
            if (!id) continue;

            let student = await Student.findOne({ studentId: id, department, year, program: targetProgram });
            if (student) {
                if (name && student.studentName !== name) {
                    await Student.updateOne({ _id: student._id }, { studentName: name });
                    updatedStudents++;
                }
            } else {
                student = await Student.create({
                    studentId: id,
                    studentName: name,
                    department,
                    year,
                    program: targetProgram,
                    academicYear,
                    classId: targetClassId
                });
                insertedStudents++;
            }

            const attDate = dateVal instanceof Date ? dateVal : new Date(dateVal);
            const status = statusRaw === 'absent' ? 'absent' : 'present';
            await Attendance.create({
                studentId: student._id,
                department,
                year,
                program: targetProgram,
                academicYear,
                classId: targetClassId,
                date: attDate,
                status,
                notes,
                recordedBy: req.user._id,
            });
            insertedAttendance++;
        }

        fs.unlink(req.file.path, err => { if (err) console.warn('Failed to delete upload', err); });
        res.json({
            success: true,
            message: 'Excel processed',
            stats: { insertedStudents, updatedStudents, insertedAttendance }
        });
    } catch (err) {
        console.error('uploadExcel error:', err);
        res.status(500).json({ success: false, message: 'Failed to process Excel', error: err.message });
    }
};

module.exports = {
    getAttendance,
    markAttendance,
    uploadExcel
};
