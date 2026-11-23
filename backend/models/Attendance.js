const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Student',
            required: false
        },
        studentId: {
            type: String,
            required: [true, 'Student register number is required'],
            trim: true,
            uppercase: true
        },
        studentName: {
            type: String,
            trim: true,
            default: ''
        },
        date: {
            type: String, // Format: YYYY-MM-DD
            required: [true, 'Attendance date is required'],
            match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD']
        },
        department: {
            type: String,
            required: [true, 'Department is required'],
            trim: true
        },
        program: {
            type: String,
            enum: ['UG', 'PG'],
            default: 'UG',
            trim: true,
            uppercase: true
        },
        year: {
            type: String,
            required: [true, 'Year is required'],
            trim: true
        },
        academicYear: {
            type: String,
            trim: true,
            default: ''
        },
        classId: {
            type: String,
            trim: true,
            uppercase: true,
            default: ''
        },
        // ── 5-Period support ──────────────────────────────────────────────────
        // period 1-5 for new records; null/undefined for legacy single-day records.
        // Legacy records (period = null) remain fully accessible and are treated
        // as a single whole-day record when no period filter is applied.
        period: {
            type: Number,
            enum: [null, 1, 2, 3, 4, 5],
            default: null
        },
        status: {
            type: String,
            enum: ['present', 'absent'],
            required: [true, 'Status must be present or absent']
        },
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    {
        timestamps: true
    }
);

attendanceSchema.pre('save', function (next) {
    if (!this.program) {
        this.program = (this.classId && this.classId.startsWith('PG')) ? 'PG' : 'UG';
    }
    if (!this.classId && this.year) {
        this.classId = (this.program === 'PG') ? `PGCS${this.year}` : `CS${this.year}`;
    }
    if (!this.academicYear && this.year) {
        const sfx = this.year === '1' ? '1st' : this.year === '2' ? '2nd' : this.year === '3' ? '3rd' : `${this.year}th`;
        this.academicYear = `${sfx} Year`;
    }
    next();
});

// ── Unique indexes ─────────────────────────────────────────────────────────────
//
// We need TWO separate compound unique indexes because MongoDB's unique index
// treats null values as distinct from each other by default for sparse fields,
// but we want exactly one legacy record and one per-period record per student/date/class.
//
// Strategy:
//   • Legacy records (period IS NULL) → enforced by partial unique index A
//   • Period records (period 1-5)     → enforced by partial unique index B
//
// This lets old data live alongside new period data with no duplicates in either group.

// Index A: legacy whole-day records (period is null)
attendanceSchema.index(
    { studentId: 1, date: 1, department: 1, year: 1, program: 1 },
    {
        unique: true,
        partialFilterExpression: { period: { $type: 'null' } },
        name: 'unique_attendance_legacy'
    }
);

// Index B: per-period records (period 1-5)
attendanceSchema.index(
    { studentId: 1, date: 1, department: 1, year: 1, program: 1, period: 1 },
    {
        unique: true,
        partialFilterExpression: { period: { $in: [1, 2, 3, 4, 5] } },
        name: 'unique_attendance_period'
    }
);

// Index for high-performance date-range report queries
attendanceSchema.index({ program: 1, department: 1, year: 1, date: 1 });
attendanceSchema.index({ classId: 1, date: 1 });
// Period-specific query index
attendanceSchema.index({ classId: 1, date: 1, period: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
