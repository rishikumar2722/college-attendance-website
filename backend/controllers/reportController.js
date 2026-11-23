const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const { deleteFile } = require('../utils/gridFS');
const { sortStudentsByRollNumber } = require('../utils/rollNumberHelper');

const ALL_PERIODS = [1, 2, 3, 4, 5];

/**
 * Helper function to get year suffix (st, nd, rd, th)
 */
function getYearSuffix(year) {
    switch (String(year)) {
        case '1': return 'st';
        case '2': return 'nd';
        case '3': return 'rd';
        default: return 'th';
    }
}

/**
 * @desc    Generate daily attendance report across departments, programs and years
 *          Now includes per-period breakdown when periods have been submitted.
 * @route   GET /api/reports/daily
 * @access  Private (Admin or Staff)
 */
const getDailyReport = async (req, res) => {
    try {
        const { date, program } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Date is required (YYYY-MM-DD format)'
            });
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({
                success: false,
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        let classConfigs = [];

        if (req.user.role === 'staff') {
            const staffDept = req.user.department || 'Computer Science';
            const staffProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
            const staffYear = req.user.year && req.user.year !== 'All' ? String(req.user.year) : '1';
            const classId = req.user.classId || (staffProgram === 'PG' ? `PGCS${staffYear}` : `CS${staffYear}`);
            classConfigs.push({ department: staffDept, program: staffProgram, year: staffYear, classId });
        } else {
            const requestedProgram = program ? String(program).trim().toUpperCase() : 'ALL';
            if (requestedProgram === 'UG' || requestedProgram === 'ALL') {
                classConfigs.push(
                    { department: 'Computer Science', program: 'UG', year: '1', classId: 'CS1' },
                    { department: 'Computer Science', program: 'UG', year: '2', classId: 'CS2' },
                    { department: 'Computer Science', program: 'UG', year: '3', classId: 'CS3' }
                );
            }
            if (requestedProgram === 'PG' || requestedProgram === 'ALL') {
                classConfigs.push(
                    { department: 'Computer Science', program: 'PG', year: '1', classId: 'PGCS1' },
                    { department: 'Computer Science', program: 'PG', year: '2', classId: 'PGCS2' }
                );
            }
        }

        const dailyReport = [];
        let serialNumber = 1;

        for (const cfg of classConfigs) {
            const baseFilter = {
                department: cfg.department,
                program: cfg.program,
                year: cfg.year,
                date: date.trim()
            };

            // Fetch active students for this class configuration
            const studentsList = await Student.find({
                department: cfg.department,
                program: cfg.program,
                year: cfg.year,
                status: 'active'
            }).collation({ locale: 'en', numericOrdering: true }).sort({ studentId: 1 }).lean();

            // Count total students for summary
            const totalStudents = studentsList.length;

            // Prepare period‑wise attendance breakdown (as before)
            const periodBreakdown = [];
            for (const p of ALL_PERIODS) {
                const periodRecords = await Attendance.find({ ...baseFilter, period: p })
                    .select('studentId status recordedBy')
                    .lean();

                if (periodRecords.length > 0) {
                    const present = periodRecords.filter(r => r.status === 'present').length;
                    const absent  = periodRecords.filter(r => r.status === 'absent').length;
                    let submittedBy = '';
                    if (periodRecords[0].recordedBy) {
                        try {
                            const User = require('../models/User');
                            const u = await User.findById(periodRecords[0].recordedBy).select('username name').lean();
                            submittedBy = (u && (u.name || u.username)) || '';
                        } catch {}
                    }
                    periodBreakdown.push({ period: p, status: 'submitted', present, absent, total: periodRecords.length, submittedBy });
                } else {
                    periodBreakdown.push({ period: p, status: 'pending', present: 0, absent: 0, total: 0, submittedBy: '' });
                }
            }

            // Legacy whole‑day records handling (unchanged)
            const legacyRecords = await Attendance.find({ ...baseFilter, period: null }).lean();

            // Summary totals (unchanged logic adapted to use studentsList length)
            const submittedPeriods = periodBreakdown.filter(p => p.status === 'submitted');
            let presentCount, absentCount, hasData;
            if (submittedPeriods.length > 0) {
                presentCount = submittedPeriods.reduce((s, p) => s + p.present, 0);
                absentCount  = submittedPeriods.reduce((s, p) => s + p.absent, 0);
                hasData = true;
            } else if (legacyRecords.length > 0) {
                presentCount = legacyRecords.filter(r => r.status === 'present').length;
                absentCount  = legacyRecords.filter(r => r.status === 'absent').length;
                hasData = true;
            } else {
                hasData = false;
            }

            const displayClassYear = `${cfg.program} ${cfg.year}${getYearSuffix(cfg.year)} Year (${cfg.classId})`;

            // Push summary entry (kept for backward compatibility)
            if (!hasData) {
                dailyReport.push({
                    serialNo: serialNumber++,
                    department: cfg.department,
                    program: cfg.program,
                    year: cfg.year,
                    classId: cfg.classId,
                    classYear: displayClassYear,
                    present: 'No attendance recorded',
                    absent: 'No attendance recorded',
                    percentage: 'No attendance recorded',
                    totalStudents,
                    periodBreakdown,
                    submittedPeriodsCount: 0,
                    isSummary: true
                });
            } else {
                const pct = totalStudents > 0
                    ? (submittedPeriods.length > 0
                        ? Math.round((presentCount / (totalStudents * submittedPeriods.length)) * 100)
                        : Math.round((presentCount / totalStudents) * 100))
                    : 0;
                dailyReport.push({
                    serialNo: serialNumber++,
                    department: cfg.department,
                    program: cfg.program,
                    year: cfg.year,
                    classId: cfg.classId,
                    classYear: displayClassYear,
                    present: presentCount,
                    absent: absentCount,
                    percentage: `${pct}%`,
                    totalStudents,
                    periodBreakdown,
                    submittedPeriodsCount: submittedPeriods.length,
                    isSummary: true
                });
            }

            // ---- Detailed per‑student rows ----
            for (const stu of studentsList) {
                const periodStatus = {};
                let present = 0, absent = 0;
                for (const p of ALL_PERIODS) {
                    const rec = await Attendance.findOne({
                        ...baseFilter,
                        period: p,
                        studentId: stu.studentId
                    }).select('status').lean();
                    const status = rec ? rec.status : 'pending';
                    periodStatus[p] = status;
                    if (status === 'present') present++;
                    if (status === 'absent') absent++;
                }
                const totalSubmitted = present + absent;
                const pct = totalSubmitted > 0 ? Math.round((present / totalSubmitted) * 100) : 0;
                dailyReport.push({
                    serialNo: serialNumber++,
                    department: cfg.department,
                    program: cfg.program,
                    year: cfg.year,
                    classId: cfg.classId,
                    classYear: displayClassYear,
                    studentId: stu.studentId,
                    studentName: stu.studentName,
                    period1: periodStatus[1],
                    period2: periodStatus[2],
                    period3: periodStatus[3],
                    period4: periodStatus[4],
                    period5: periodStatus[5],
                    present,
                    absent,
                    percentage: `${pct}%`,
                    isSummary: false
                });
            }
        }

        res.status(200).json({
            success: true,
            date,
            reportData: dailyReport,
            totalClasses: dailyReport.length
        });
    } catch (error) {
        console.error('getDailyReport error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate daily report', error: error.message });
    }
};

/**
 * @desc    Generate attendance summary report for class within date range
 * @route   GET /api/reports/attendance
 * @access  Private
 */
const getAttendanceReport = async (req, res) => {
    try {
        const { department, year, program, classId, from, to } = req.query;

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const targetClassId = classId || (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`);

        if (!targetDept || !targetYear) {
            return res.status(400).json({
                success: false,
                message: 'Department and Year are required'
            });
        }

        if (!from || !to) {
            return res.status(400).json({
                success: false,
                message: 'Start date (from) and End date (to) are required (YYYY-MM-DD)'
            });
        }

        if (from > to) {
            return res.status(400).json({
                success: false,
                message: 'From date cannot be after To date'
            });
        }

        // 1. Fetch all enrolled active students in class
        const rawStudents = await Student.find({
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            status: 'active'
        }).collation({ locale: 'en', numericOrdering: true }).sort({ studentId: 1 }).lean();

        const students = sortStudentsByRollNumber(rawStudents);

        if (students.length === 0) {
            return res.status(200).json({
                success: true,
                message: `No active students found for ${targetDept} (${targetProgram} Year ${targetYear})`,
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                classId: targetClassId,
                totalStudents: 0,
                totalRecordedDays: 0,
                report: []
            });
        }

        // 2. Fetch all attendance records in date range
        // Include both legacy (period=null) and period records
        const attendanceRecords = await Attendance.find({
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            date: { $gte: from.trim(), $lte: to.trim() }
        });

        // 3. Determine unique recorded dates/periods combinations
        // A "submitted session" is a unique date+period (or date+null for legacy)
        const recordedDatesSet = new Set(attendanceRecords.map(r => r.date));
        // For period-based records: count total period-slots submitted
        const periodSlots = new Set(attendanceRecords.map(r => `${r.date}:${r.period}`));
        // Legacy records: date:null slots
        const legacyDateSlots = new Set(
            attendanceRecords.filter(r => r.period === null || r.period === undefined).map(r => r.date)
        );
        // Period records: slots with period 1-5
        const periodDateSlots = new Set(
            attendanceRecords.filter(r => r.period !== null && r.period !== undefined).map(r => `${r.date}:${r.period}`)
        );

        const hasPeriodRecords = periodDateSlots.size > 0;

        let totalTrackedDays = recordedDatesSet.size;

        // Fallback: If no explicit attendance was recorded, calculate weekdays count
        if (totalTrackedDays === 0) {
            let count = 0;
            let cur = new Date(from);
            const end = new Date(to);
            while (cur <= end) {
                const day = cur.getDay();
                if (day !== 0 && day !== 6) count++;
                cur.setDate(cur.getDate() + 1);
            }
            totalTrackedDays = count > 0 ? count : 1;
        }

        // Total period sessions = unique date:period combinations
        const totalPeriodSessions = hasPeriodRecords ? periodDateSlots.size : 0;

        // 4. Calculate individual student attendance metrics
        const report = students.map((s, idx) => {
            const sId = s.studentId.trim().toUpperCase();
            const studentRecords = attendanceRecords.filter(r => r.studentId.trim().toUpperCase() === sId);

            if (hasPeriodRecords) {
                // Period-based calculation
                const periodRecordsOnly = studentRecords.filter(r => r.period !== null && r.period !== undefined);
                const presentPeriods = periodRecordsOnly.filter(r => r.status === 'present').length;
                const absentPeriods  = periodRecordsOnly.filter(r => r.status === 'absent').length;
                const totalSubmitted  = presentPeriods + absentPeriods;
                const pct = totalSubmitted > 0 ? Math.round((presentPeriods / totalSubmitted) * 100) : 100;

                return {
                    serial: idx + 1,
                    studentId: s.studentId,
                    studentName: s.studentName,
                    totalDays: totalTrackedDays,
                    totalPeriodSessions,
                    totalSubmitted,
                    present: presentPeriods,
                    absent: absentPeriods,
                    percentage: pct
                };
            } else {
                // Legacy whole-day calculation
                const absentDays = studentRecords.filter(r => r.status === 'absent').length;
                const effectiveTotal = Math.max(totalTrackedDays, absentDays);
                const presentDays = Math.max(0, effectiveTotal - absentDays);
                const percentage = effectiveTotal > 0 ? Math.round((presentDays / effectiveTotal) * 100) : 100;

                return {
                    serial: idx + 1,
                    studentId: s.studentId,
                    studentName: s.studentName,
                    totalDays: effectiveTotal,
                    totalPeriodSessions: 0,
                    totalSubmitted: effectiveTotal,
                    present: presentDays,
                    absent: absentDays,
                    percentage
                };
            }
        });

        res.status(200).json({
            success: true,
            department: targetDept,
            year: targetYear,
            program: targetProgram,
            classId: targetClassId,
            from,
            to,
            totalStudents: students.length,
            totalRecordedDays: totalTrackedDays,
            totalPeriodSessions,
            hasPeriodRecords,
            report
        });
    } catch (error) {
        console.error('getAttendanceReport error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate attendance report',
            error: error.message
        });
    }
};

/**
 * @desc    View all enrolled students for class (Student Data button in report)
 * @route   GET /api/reports/students
 * @access  Private
 */
const getClassStudents = async (req, res) => {
    try {
        const { department, year, program, classId } = req.query;

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const rawStudents = await Student.find({
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            status: 'active'
        }).collation({ locale: 'en', numericOrdering: true }).sort({ studentId: 1 }).lean();

        const students = sortStudentsByRollNumber(rawStudents);
        students.forEach((s, idx) => {
            s.serial = idx + 1;
        });

        res.status(200).json({
            success: true,
            department: targetDept,
            year: targetYear,
            program: targetProgram,
            count: students.length,
            students
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve class student data',
            error: error.message
        });
    }
};

/**
 * @desc    Count students and attendance records for a class (Admin Only)
 * @route   GET /api/reports/class/summary
 * @access  Private (Admin Only)
 */
const getClassSummary = async (req, res) => {
    try {
        const department = String(req.query.department || '').trim();
        const rawYear = String(req.query.year || '').trim();
        const program = req.query.program ? String(req.query.program).trim().toUpperCase() : undefined;

        if (!department) {
            return res.status(400).json({
                success: false,
                message: 'Department is required'
            });
        }

        const filter = { department };
        if (rawYear && rawYear.toLowerCase() !== 'all') {
            filter.year = rawYear;
        }
        if (program) {
            filter.program = program;
        }

        const [studentCount, attendanceCount] = await Promise.all([
            Student.countDocuments(filter),
            Attendance.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            department,
            year: filter.year || 'All',
            program: program || 'All',
            studentCount,
            attendanceCount
        });
    } catch (error) {
        console.error('getClassSummary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load class summary',
            error: error.message
        });
    }
};

/**
 * @desc    Delete all students and attendance for a class (Admin Only)
 * @route   DELETE /api/reports/class
 * @access  Private (Admin Only)
 */
const deleteClassData = async (req, res) => {
    try {
        const body = req.body || {};
        const department = String(body.department || '').trim();
        const rawYear = String(body.year || '').trim();
        const program = body.program ? String(body.program).trim().toUpperCase() : undefined;

        if (!department) {
            return res.status(400).json({
                success: false,
                message: 'Department is required to delete class data'
            });
        }

        const deleteYear = rawYear && rawYear.toLowerCase() !== 'all' ? rawYear : null;

        const filter = { department };
        if (deleteYear) {
            filter.year = deleteYear;
        }
        if (program) {
            filter.program = program;
        }

        // Collect stored photos so they can be removed from GridFS too
        const studentsToDelete = await Student.find(filter).select('photoId').lean();
        const photoIds = studentsToDelete.map(s => s.photoId).filter(Boolean);

        const studentDeleteResult = await Student.deleteMany(filter);
        const attendanceDeleteResult = await Attendance.deleteMany(filter);

        for (const photoId of photoIds) {
            try {
                await deleteFile(photoId);
            } catch (photoError) {
                console.warn('Could not delete student photo:', photoId.toString(), photoError.message);
            }
        }

        const scopeText = `${department} ${program ? program + ' ' : ''}${deleteYear ? 'Year ' + deleteYear : '(all years)'}`;

        res.status(200).json({
            success: true,
            message: `Deleted ${studentDeleteResult.deletedCount} students and ${attendanceDeleteResult.deletedCount} attendance records for ${scopeText}`,
            department,
            year: deleteYear || 'All',
            program: program || 'All',
            deletedStudents: studentDeleteResult.deletedCount,
            deletedAttendance: attendanceDeleteResult.deletedCount
        });
    } catch (error) {
        console.error('deleteClassData error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete class data',
            error: error.message
        });
    }
};

/**
 * @desc    Get per-period submission status for a class on a specific date (Admin)
 * @route   GET /api/reports/period-status?date=YYYY-MM-DD&classId=CS1&department=...&program=UG&year=1
 * @access  Private (Admin)
 */
const getPeriodStatus = async (req, res) => {
    try {
        const { date, classId, department, program, year } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ success: false, message: 'Valid date is required (YYYY-MM-DD)' });
        }

        const targetDept    = department || 'Computer Science';
        const targetProgram = program    ? String(program).trim().toUpperCase() : 'UG';
        const targetYear    = String(year || '1');
        const targetClassId = classId   || (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`);

        const totalStudents = await Student.countDocuments({
            department: targetDept, program: targetProgram, year: targetYear, status: 'active'
        });

        const User = require('../models/User');
        const periods = [];

        for (const p of ALL_PERIODS) {
            const records = await Attendance.find({
                department: targetDept,
                program: targetProgram,
                year: targetYear,
                date: date.trim(),
                period: p
            }).select('studentId status recordedBy studentName').lean();

            let submittedBy = '';
            let submittedAt = null;
            if (records.length > 0 && records[0].recordedBy) {
                try {
                    const u = await User.findById(records[0].recordedBy).select('username name').lean();
                    submittedBy = (u && (u.name || u.username)) || '';
                } catch {}
            }

            if (records.length > 0) {
                const present = records.filter(r => r.status === 'present').length;
                const absent  = records.filter(r => r.status === 'absent').length;
                const absentStudents = records
                    .filter(r => r.status === 'absent')
                    .map(r => ({ studentId: r.studentId, studentName: r.studentName }));

                periods.push({
                    period: p,
                    status: 'submitted',
                    present,
                    absent,
                    totalSubmitted: records.length,
                    totalStudents,
                    submittedBy,
                    absentStudents
                });
            } else {
                periods.push({
                    period: p,
                    status: 'pending',
                    present: 0,
                    absent: 0,
                    totalSubmitted: 0,
                    totalStudents,
                    submittedBy: '',
                    absentStudents: []
                });
            }
        }

        const submittedCount = periods.filter(p => p.status === 'submitted').length;

        res.status(200).json({
            success: true,
            date,
            classId: targetClassId,
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            totalStudents,
            submittedPeriods: submittedCount,
            pendingPeriods: ALL_PERIODS.length - submittedCount,
            periods
        });
    } catch (error) {
        console.error('getPeriodStatus error:', error);
        res.status(500).json({ success: false, message: 'Failed to get period status', error: error.message });
    }
};

/**
 * @desc    Get date-wise + period-wise attendance detail for a single student
 * @route   GET /api/reports/student-detail?studentId=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD
 * @access  Private (Admin or Staff for their own class)
 */
const getStudentDetail = async (req, res) => {
    try {
        const { studentId, from, to } = req.query;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId is required' });
        }
        if (!from || !to) {
            return res.status(400).json({ success: false, message: 'from and to dates are required (YYYY-MM-DD)' });
        }
        if (from > to) {
            return res.status(400).json({ success: false, message: 'from date cannot be after to date' });
        }

        const normId = String(studentId).trim().toUpperCase();

        // Authorization: staff can only view their own class
        const filter = { studentId: normId, date: { $gte: from, $lte: to } };
        if (req.user.role === 'staff') {
            filter.department = req.user.department;
            filter.year       = req.user.year;
            filter.program    = req.user.program || 'UG';
        }

        const student = await Student.findOne({ studentId: normId }).select('studentId studentName department program year classId').lean();
        const records = await Attendance.find(filter).sort({ date: 1, period: 1 }).lean();

        // Group by date
        const byDate = {};
        records.forEach(r => {
            if (!byDate[r.date]) byDate[r.date] = { date: r.date, periods: {}, legacyStatus: null };
            if (r.period !== null && r.period !== undefined) {
                byDate[r.date].periods[r.period] = r.status;
            } else {
                byDate[r.date].legacyStatus = r.status;
            }
        });

        const dateEntries = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

        // Calculate totals
        let totalPresentPeriods = 0;
        let totalAbsentPeriods  = 0;
        let totalSubmittedPeriods = 0;

        dateEntries.forEach(entry => {
            const pKeys = Object.keys(entry.periods);
            if (pKeys.length > 0) {
                pKeys.forEach(p => {
                    totalSubmittedPeriods++;
                    if (entry.periods[p] === 'present') totalPresentPeriods++;
                    else totalAbsentPeriods++;
                });
            } else if (entry.legacyStatus !== null) {
                totalSubmittedPeriods++;
                if (entry.legacyStatus === 'present') totalPresentPeriods++;
                else totalAbsentPeriods++;
            }
        });

        const overallPercentage = totalSubmittedPeriods > 0
            ? Math.round((totalPresentPeriods / totalSubmittedPeriods) * 100)
            : 100;

        res.status(200).json({
            success: true,
            student: student || { studentId: normId },
            from,
            to,
            totalDates: dateEntries.length,
            totalPresentPeriods,
            totalAbsentPeriods,
            totalSubmittedPeriods,
            overallPercentage,
            dateWise: dateEntries
        });
    } catch (error) {
        console.error('getStudentDetail error:', error);
        res.status(500).json({ success: false, message: 'Failed to get student detail', error: error.message });
    }
};

module.exports = {
    getAttendanceReport,
    getClassStudents,
    deleteClassData,
    getClassSummary,
    getDailyReport,
    getPeriodStatus,
    getStudentDetail
};
