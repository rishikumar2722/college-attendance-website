/* ========================================================
   dailyreport.js - Daily College Attendance Report (UG & PG)
   Admin-only report (UG/PG filter)
   ======================================================== */

let currentUser = null;
let currentReportData = null;
let selectedDate = null;

const API_BASE_URL = 'http://localhost:5000/api';

/**
 * Check authentication and load user info
 */
function checkAuth() {
    try {
        currentUser = JSON.parse(localStorage.getItem("currentUser"));

        if (!currentUser) {
            alert("Please login first.");
            window.location.href = "index.html";
            return false;
        }

        if (currentUser.role !== "admin") {
            alert("Access denied. Daily reports are available to administrators only.");
            window.location.href = currentUser.role === "staff" ? "home.html" : "index.html";
            return false;
        }

        return true;
    } catch (error) {
        console.error("Authentication check failed:", error);
        alert("Authentication error. Please login again.");
        window.location.href = "index.html";
        return false;
    }
}

/**
 * Load and display user info
 */
function loadAdminInfo() {
    if (!checkAuth()) return;

    const userInfoElem = document.getElementById("userInfo");
    const programContainer = document.getElementById("adminProgramContainer");

    if (currentUser.role === "admin") {
        if (userInfoElem) {
            userInfoElem.innerText = "Administrator";
        }
        if (programContainer) {
            programContainer.style.display = "inline-flex";
        }
    } else {
        // Staff
        if (userInfoElem) {
            const username = currentUser.name || currentUser.username || "Staff";
            const prog = currentUser.program || (currentUser.classId && currentUser.classId.startsWith('PG') ? 'PG' : 'UG');
            const classText = currentUser.classId || `${prog} Year ${currentUser.year || '1'}`;
            userInfoElem.innerText = `Staff: ${username} (${classText})`;
        }
        if (programContainer) {
            programContainer.style.display = "none";
        }
    }
}

/**
 * Set default date to today
 */
function setDefaultDate() {
    const today = new Date();
    const dateInput = document.getElementById("reportDate");
    if (dateInput) {
        dateInput.value = today.toISOString().split('T')[0];
    }
}

/**
 * Show loading state
 */
function showLoading() {
    hideAllMessages();
    const loadingEl = document.getElementById("loadingMessage");
    if (loadingEl) {
        loadingEl.style.display = "block";
    }
    const tableEl = document.getElementById("reportTable");
    if (tableEl) {
        tableEl.style.display = "none";
    }
}

/**
 * Show error message
 */
function showError(message) {
    hideAllMessages();
    const errorEl = document.getElementById("errorMessage");
    if (errorEl) {
        errorEl.style.display = "block";
        errorEl.textContent = message;
    }
    const tableEl = document.getElementById("reportTable");
    if (tableEl) {
        tableEl.style.display = "none";
    }
}

/**
 * Show no data message
 */
function showNoData(message) {
    hideAllMessages();
    const noDataEl = document.getElementById("noDataMessage");
    if (noDataEl) {
        noDataEl.style.display = "block";
        noDataEl.textContent = message;
    }
    const tableEl = document.getElementById("reportTable");
    if (tableEl) {
        tableEl.style.display = "none";
    }
}

/**
 * Hide all status messages
 */
function hideAllMessages() {
    const elements = ['loadingMessage', 'errorMessage', 'noDataMessage'];
    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = "none";
        }
    });
}

function getYearSuffix(year) {
    switch (String(year)) {
        case '1': return 'st';
        case '2': return 'nd';
        case '3': return 'rd';
        default: return 'th';
    }
}

/**
 * Fallback to generate report data from localStorage
 */
function getLocalStorageReportData(selectedDate, filterProgram) {
    try {
        const allLedger = JSON.parse(localStorage.getItem("all_attendance_ledger")) || [];
        const students = JSON.parse(localStorage.getItem("students")) || [];

        const dateRecords = allLedger.filter(entry => entry.date === selectedDate);
        let classConfigs = [];

        if (currentUser.role === 'staff') {
            const prog = currentUser.program || (currentUser.classId && currentUser.classId.startsWith('PG') ? 'PG' : 'UG');
            const yr = String(currentUser.year || '1');
            const classId = currentUser.classId || (prog === 'PG' ? `PGCS${yr}` : `CS${yr}`);
            classConfigs.push({ department: 'Computer Science', program: prog, year: yr, classId });
        } else {
            const prog = filterProgram || 'ALL';
            if (prog === 'UG' || prog === 'ALL') {
                classConfigs.push(
                    { department: 'Computer Science', program: 'UG', year: '1', classId: 'CS1' },
                    { department: 'Computer Science', program: 'UG', year: '2', classId: 'CS2' },
                    { department: 'Computer Science', program: 'UG', year: '3', classId: 'CS3' }
                );
            }
            if (prog === 'PG' || prog === 'ALL') {
                classConfigs.push(
                    { department: 'Computer Science', program: 'PG', year: '1', classId: 'PGCS1' },
                    { department: 'Computer Science', program: 'PG', year: '2', classId: 'PGCS2' }
                );
            }
        }

        const reportData = [];
        let serialNumber = 1;

        for (const cfg of classConfigs) {
            const totalStudents = students.filter(s =>
                s.department && s.department.trim().toLowerCase() === cfg.department.toLowerCase() &&
                String(s.year).trim() === cfg.year &&
                String(s.program || (s.classId && s.classId.startsWith('PG') ? 'PG' : 'UG')).toUpperCase() === cfg.program
            ).length;

            const submittedRecord = dateRecords.find(entry =>
                entry.department && entry.department.trim().toLowerCase() === cfg.department.toLowerCase() &&
                String(entry.year).trim() === cfg.year &&
                String(entry.program || (entry.classId && entry.classId.startsWith('PG') ? 'PG' : 'UG')).toUpperCase() === cfg.program
            );

            const classLabel = `${cfg.program} ${cfg.year}${getYearSuffix(cfg.year)} Year (${cfg.classId})`;

            if (!submittedRecord || !submittedRecord.records) {
                reportData.push({
                    serialNo: serialNumber++,
                    department: cfg.department,
                    program: cfg.program,
                    year: cfg.year,
                    classId: cfg.classId,
                    classYear: classLabel,
                    present: 'No attendance recorded',
                    absent: 'No attendance recorded',
                    percentage: 'No attendance recorded',
                    totalStudents: totalStudents
                });
            } else {
                const records = submittedRecord.records;
                const presentCount = records.filter(r => r.status === 'present').length;
                const absentCount = records.filter(r => r.status === 'absent').length;
                const percentage = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

                reportData.push({
                    serialNo: serialNumber++,
                    department: cfg.department,
                    program: cfg.program,
                    year: cfg.year,
                    classId: cfg.classId,
                    classYear: classLabel,
                    present: presentCount,
                    absent: absentCount,
                    percentage: `${percentage}%`,
                    totalStudents: totalStudents
                });
            }
        }

        return reportData;
    } catch (error) {
        console.error('Error getting localStorage data:', error);
        return [];
    }
}

/**
 * Generate daily attendance report
 */
async function generateDailyReport() {
    const dateInput = document.getElementById("reportDate");
    const messageArea = document.getElementById("messageArea");
    const programSelect = document.getElementById("reportProgram");

    if (!dateInput) return;
    selectedDate = dateInput.value;

    if (messageArea) messageArea.innerHTML = "";

    if (!selectedDate) {
        if (messageArea) messageArea.innerHTML = '<span style="color: #ff6b6b;">Please select a date.</span>';
        dateInput.focus();
        return;
    }

    showLoading();

    const token = localStorage.getItem("token");
    const requestedProgram = (programSelect && currentUser.role === 'admin') ? programSelect.value : 'ALL';

    // 1. Try Backend API
    try {
        if (token) {
            let url = `${API_BASE_URL}/reports/daily?date=${encodeURIComponent(selectedDate)}`;
            if (currentUser.role === 'admin' && requestedProgram) {
                url += `&program=${encodeURIComponent(requestedProgram)}`;
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.reportData)) {
                    currentReportData = data;
                    displayReportTable(currentReportData);
                    if (messageArea) {
                        messageArea.innerHTML = '<span style="color: #51cf66;">✅ Daily report generated from database!</span>';
                    }
                    return;
                }
            }
        }
    } catch (apiErr) {
        console.warn('API error in generateDailyReport, using localStorage fallback:', apiErr.message);
    }

    // 2. Fallback to localStorage
    try {
        const reportData = getLocalStorageReportData(selectedDate, requestedProgram);
        currentReportData = {
            success: true,
            date: selectedDate,
            reportData: reportData
        };
        displayReportTable(currentReportData);
        if (messageArea) {
            messageArea.innerHTML = '<span style="color: #51cf66;">✅ Daily report generated!</span>';
        }
    } catch (error) {
        console.error('Error generating daily report:', error);
        showError(`Failed to generate report: ${error.message}`);
    }
}

/**
 * Display the report data in table format (5-period aware)
 */
function displayReportTable(data) {
    const reportData = data.reportData || [];

    if (reportData.length === 0) {
        showNoData(`No classes found for ${selectedDate}.`);
        return;
    }

    const tableBody = document.getElementById("reportTableBody");
    if (!tableBody) {
        showError("Report table not found.");
        return;
    }

    tableBody.innerHTML = "";
    let hasAnyData = false;

    reportData.forEach((classData) => {
        const row = document.createElement("tr");

        // Helper to add a plain cell
        function tc(text, style) {
            const td = document.createElement("td");
            td.textContent = text === null || text === undefined ? '—' : String(text);
            if (style) td.style.cssText = style;
            row.appendChild(td);
            return td;
        }

        tc(classData.serialNo);

        const deptCell = document.createElement("td");
        deptCell.textContent = classData.department;
        deptCell.className = "dept-cell";
        row.appendChild(deptCell);

        const classCell = document.createElement("td");
        classCell.textContent = classData.classYear;
        classCell.className = "class-cell";
        row.appendChild(classCell);

        tc(classData.totalStudents, "font-weight:bold;color:#67e8f9;");

        // Per-period columns P1-P5
        const breakdown = classData.periodBreakdown || [];
        breakdown.forEach(p => {
            const td = document.createElement("td");
            if (p.status === 'submitted') {
                td.innerHTML = `<span style="color:#4caf50;font-weight:600;">✓</span><br><small style="color:#a7f3d0;font-size:11px;">${p.present}P/${p.absent}A</small>`;
                hasAnyData = true;
            } else {
                td.innerHTML = `<span style="color:#9ca3af;font-size:11px;">—</span>`;
            }
            td.style.textAlign = 'center';
            row.appendChild(td);
        });

        // Submitted periods count
        tc(classData.submittedPeriodsCount !== undefined ? `${classData.submittedPeriodsCount}/5` : '—', "font-weight:bold;");

        // Present / Absent / Percentage
        if (typeof classData.present === 'number' || (typeof classData.present === 'string' && !isNaN(Number(classData.present)))) {
            tc(classData.present, "color:#4caf50;font-weight:600;");
            tc(classData.absent, "color:#ff6b6b;font-weight:600;");

            const percentageCell = document.createElement("td");
            percentageCell.textContent = classData.percentage;
            percentageCell.className = "percentage-cell";
            if (typeof classData.percentage === 'string' && classData.percentage.includes('%')) {
                const pv = parseInt(classData.percentage);
                if (!isNaN(pv)) {
                    percentageCell.className += pv >= 85 ? ' percentage-high' : pv >= 70 ? ' percentage-medium' : ' percentage-low';
                }
            }
            row.appendChild(percentageCell);
        } else {
            const noDataTd = document.createElement("td");
            noDataTd.colSpan = 3;
            noDataTd.style.cssText = "color:#b3b3b3;font-style:italic;text-align:center;";
            noDataTd.textContent = 'No attendance recorded';
            row.appendChild(noDataTd);
        }

        tableBody.appendChild(row);
    });

    hideAllMessages();
    const table = document.getElementById("reportTable");
    if (table) table.style.display = "table";

    // Render period status panel
    renderPeriodStatusPanel(reportData);

    if (!hasAnyData) {
        const messageArea = document.getElementById("messageArea");
        if (messageArea) {
            messageArea.innerHTML = '<span style="color: #ffc107;">⚠️ No attendance has been recorded for this date yet.</span>';
        }
    }
}

/**
 * Renders a summary panel showing period submission status per class
 */
function renderPeriodStatusPanel(reportData) {
    const panel = document.getElementById("periodStatusPanel");
    if (!panel) return;

    const rows = reportData.map(c => {
        const breakdown = c.periodBreakdown || [];
        const pills = breakdown.map(p => {
            const color = p.status === 'submitted' ? '#4ade80' : '#6b7280';
            const bg = p.status === 'submitted' ? 'rgba(74,222,128,0.15)' : 'rgba(107,114,128,0.15)';
            const info = p.status === 'submitted' ? ` ${p.present}P/${p.absent}A` : '';
            return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;margin:2px;font-size:12px;color:${color};background:${bg};border:1px solid ${color}40;">P${p.period}${p.status === 'submitted' ? '✓' + info : ''}</span>`;
        }).join('');
        return `
            <div style="margin-bottom:8px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
                <span style="color:#e2e8f0;font-weight:600;min-width:120px;">${c.classId}:</span>
                ${pills}
                <span style="color:#94a3b8;font-size:12px;">${c.submittedPeriodsCount || 0}/5 submitted</span>
            </div>`;
    }).join('');

    panel.innerHTML = `
        <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:16px;border:1px solid rgba(255,255,255,0.1);">
            <h3 style="color:#e2e8f0;font-size:15px;font-weight:700;margin:0 0 12px;">Period Submission Status</h3>
            ${rows}
        </div>`;
    panel.style.display = 'block';
}

/**
 * Download PDF report
 */
async function downloadPDFReport() {
    const messageArea = document.getElementById("messageArea");

    if (!currentReportData || !currentReportData.reportData || currentReportData.reportData.length === 0) {
        if (messageArea) {
            messageArea.innerHTML = '<span style="color: #ff6b6b;">Please generate a report first.</span>';
        }
        return;
    }

    try {
        if (typeof window.jspdf === 'undefined') {
            alert("PDF library is loading. Please try again in a moment.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        await addCollegePdfHeader(doc);

        // College Header
        doc.setFontSize(13);
        doc.setFont(undefined, 'bold');
        doc.text(`DAILY ATTENDANCE REPORT - ${selectedDate}`, 105, 43, { align: "center" });

        // Build Table
        const tableColumns = ["S.No", "Department", "Class", "Strength", "P1", "P2", "P3", "P4", "P5", "Submitted", "Present", "Absent", "%"];
        const tableRows = currentReportData.reportData.map(r => {
            const bd = r.periodBreakdown || [];
            const pCols = bd.map(p => p.status === 'submitted' ? `✓(${p.present}P/${p.absent}A)` : '—');
            return [
                r.serialNo, r.department, r.classYear, r.totalStudents,
                ...pCols,
                r.submittedPeriodsCount !== undefined ? `${r.submittedPeriodsCount}/5` : '—',
                r.present, r.absent, r.percentage
            ];
        });

        doc.autoTable({
            head: [tableColumns],
            body: tableRows,
            startY: 50,
            theme: 'grid',
            headStyles: { fillColor: [40, 50, 100], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3, halign: 'center' }
        });

        doc.save(`Daily_Attendance_Report_${selectedDate}.pdf`);

        if (messageArea) {
            messageArea.innerHTML = '<span style="color: #51cf66;">✅ PDF downloaded successfully!</span>';
        }
    } catch (e) {
        console.error("PDF download error:", e);
        if (messageArea) {
            messageArea.innerHTML = `<span style="color: #ff6b6b;">❌ Failed to generate PDF: ${e.message}</span>`;
        }
    }
}

/**
 * Go back navigation
 */
function goBack() {
    if (currentUser && currentUser.role === 'admin') {
        window.location.href = "admin.html";
    } else {
        window.location.href = "home.html";
    }
}

function goBackToAdmin() {
    goBack();
}

document.addEventListener("DOMContentLoaded", function() {
    try {
        loadAdminInfo();
        setDefaultDate();
    } catch (error) {
        console.error('Error initializing daily report page:', error);
    }
});

function logout() {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem("currentUser");
        localStorage.removeItem("token");
        window.location.href = "index.html";
    }
}
