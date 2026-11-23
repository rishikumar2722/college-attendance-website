const express = require('express');
const router = express.Router();
const {
    getAttendanceReport,
    getClassStudents,
    deleteClassData,
    getClassSummary,
    getDailyReport,
    getPeriodStatus,
    getStudentDetail
} = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole, enforceClassScope } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/attendance',       enforceClassScope, getAttendanceReport);
router.get('/students',         enforceClassScope, getClassStudents);
router.get('/class/summary',    requireRole('admin'), getClassSummary);
router.delete('/class',         requireRole('admin'), deleteClassData);
router.get('/daily',            getDailyReport);

// 5-Period specific routes
router.get('/period-status',    enforceClassScope, getPeriodStatus);
router.get('/student-detail',   enforceClassScope, getStudentDetail);

module.exports = router;
