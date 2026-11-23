/* ========================================================
   studentsdata.js - JavaScript for studentsdata.html
   ======================================================== */

let currentUser = null;
const BASE_URL = 'http://localhost:5000/api';
let students = [];
let selectedDepartment = "";
let selectedProgram = "UG";
let currentProgramTab = "UG";
let filteredStudents = [];

/**
 * Requirement 8: Program Tab Selection (UG / PG)
 */
function selectProgramTab(prog) {
    currentProgramTab = prog;
    selectedProgram = prog;

    const btnUG = document.getElementById("btnUGProgram");
    const btnPG = document.getElementById("btnPGProgram");

    if (btnUG && btnPG) {
        if (prog === 'UG') {
            btnUG.style.backgroundColor = '#2563eb';
            btnUG.style.borderColor = '#60a5fa';
            btnPG.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            btnPG.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        } else {
            btnPG.style.backgroundColor = '#2563eb';
            btnPG.style.borderColor = '#60a5fa';
            btnUG.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            btnUG.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        }
    }

    renderYearButtons();
}

/**
 * Requirement 8: Render Year Buttons based on UG or PG
 */
function renderYearButtons() {
    const container = document.getElementById("yearButtonsGroup");
    if (!container) return;

    container.innerHTML = "";

    if (currentProgramTab === 'UG') {
        const ugYears = [
            { year: '1', classId: 'CS1', label: 'UG 1st Year (CS1)', color: '#2563eb' },
            { year: '2', classId: 'CS2', label: 'UG 2nd Year (CS2)', color: '#28a745' },
            { year: '3', classId: 'CS3', label: 'UG 3rd Year (CS3)', color: '#7c3aed' }
        ];
        ugYears.forEach(y => {
            const btn = document.createElement("button");
            btn.style.cssText = `font-size: 15px; padding: 14px 26px; min-width: 190px; background-color: ${y.color}; color: white; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: transform 0.2s;`;
            btn.innerHTML = `${y.label}`;
            btn.onmouseover = () => { btn.style.transform = 'translateY(-2px)'; };
            btn.onmouseout = () => { btn.style.transform = 'translateY(0)'; };
            btn.onclick = () => selectClassFromButton('UG', y.year, y.classId);
            container.appendChild(btn);
        });
    } else {
        const pgYears = [
            { year: '1', classId: 'PGCS1', label: 'PG 1st Year (PGCS1)', color: '#0891b2' },
            { year: '2', classId: 'PGCS2', label: 'PG 2nd Year (PGCS2)', color: '#d97706' }
        ];
        pgYears.forEach(y => {
            const btn = document.createElement("button");
            btn.style.cssText = `font-size: 15px; padding: 14px 26px; min-width: 190px; background-color: ${y.color}; color: white; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: transform 0.2s;`;
            btn.innerHTML = `${y.label}`;
            btn.onmouseover = () => { btn.style.transform = 'translateY(-2px)'; };
            btn.onmouseout = () => { btn.style.transform = 'translateY(0)'; };
            btn.onclick = () => selectClassFromButton('PG', y.year, y.classId);
            container.appendChild(btn);
        });
    }
}

/**
 * Requirement 8: Select class and fetch directly from MongoDB
 */
async function selectClassFromButton(program, year, classId) {
    selectedProgram = program;
    selectedDepartment = "Computer Science";

    // Update Academic Year dropdown options based on program
    const dataYearEl = document.getElementById("dataYear");
    if (dataYearEl) {
        if (program === 'PG') {
            dataYearEl.innerHTML = `
                <option value="">All PG Years</option>
                <option value="1">PG 1st Year (PGCS1)</option>
                <option value="2">PG 2nd Year (PGCS2)</option>
            `;
        } else {
            dataYearEl.innerHTML = `
                <option value="">All UG Years</option>
                <option value="1">UG 1st Year (CS1)</option>
                <option value="2">UG 2nd Year (CS2)</option>
                <option value="3">UG 3rd Year (CS3)</option>
            `;
        }
        dataYearEl.value = year || "";
    }

    // Hide selection and show view
    document.getElementById("departmentSelection").style.display = "none";
    document.getElementById("studentsDataView").style.display = "block";

    const sfx = year === '1' ? 'st' : year === '2' ? 'nd' : year === '3' ? 'rd' : 'th';
    const classTitle = year ? `${program} ${year}${sfx} Year (${classId})` : `All ${program} Years`;
    document.getElementById("selectedDeptInfo").innerHTML = `Computer Science · ${classTitle}`;

    await fetchAndDisplayClassStudents(program, year, "Computer Science");
}

async function fetchAndDisplayClassStudents(program, year, department) {
    const token = localStorage.getItem("token");
    if (!token) {
        students = [];
        filteredStudents = [];
        displayStudentsTable();
        document.getElementById("messageArea").textContent = "Authentication is required to load current student records.";
        return;
    }

    try {
        let url = `${BASE_URL}/students?department=${encodeURIComponent(department)}&program=${encodeURIComponent(program)}`;
        if (year) {
            url += `&year=${encodeURIComponent(year)}`;
        }

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        if (!res.ok || !data.success || !Array.isArray(data.students)) {
            throw new Error(data.message || "Unable to load current student records from MongoDB");
        }
        students = data.students;
        filteredStudents = sortStudentsByRollNumber(students);
        displayStudentsTable();
        return;
    } catch (e) {
        console.error("fetchAndDisplayClassStudents error:", e);
    }

    students = [];
    filteredStudents = [];
    displayStudentsTable();
    document.getElementById("messageArea").textContent = "Unable to load current student records from MongoDB. Please check the server and try again.";
}

/**
 * Natural (numeric-aware) roll number comparator.
 * Correctly sorts 24UCS010 before 24UCS020 before 24UCS100.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareRollNumbers(a, b) {
    const strA = String(a || '').trim().toUpperCase();
    const strB = String(b || '').trim().toUpperCase();
    const chunksA = strA.match(/(\d+|[^\d]+)/g) || [strA];
    const chunksB = strB.match(/(\d+|[^\d]+)/g) || [strB];
    const len = Math.max(chunksA.length, chunksB.length);
    for (let i = 0; i < len; i++) {
        const ca = chunksA[i] || '';
        const cb = chunksB[i] || '';
        if (/^\d+$/.test(ca) && /^\d+$/.test(cb)) {
            const diff = parseInt(ca, 10) - parseInt(cb, 10);
            if (diff !== 0) return diff;
        } else {
            if (ca < cb) return -1;
            if (ca > cb) return 1;
        }
    }
    return 0;
}

/**
 * Sort students array by roll number (studentId) in ascending numeric order.
 * Returns a new sorted array; does not mutate the original.
 * @param {Array} arr
 * @returns {Array}
 */
function sortStudentsByRollNumber(arr) {
    if (!Array.isArray(arr)) return [];
    return [...arr].sort((a, b) =>
        compareRollNumbers(a.studentId || a.id || '', b.studentId || b.id || '')
    );
}

// Department data with icons
const departments = {
    "Computer Science": { icon: "", name: "Computer Science" },
    "Information Technology": { icon: "🌐", name: "Information Technology" },
    "Tamil": { icon: "", name: "Tamil" },
    "English": { icon: "", name: "English" }
};

/**
 * Check authentication and load user info
 * Allows both Admin and Staff users
 */
function checkAuth() {
    currentUser = JSON.parse(localStorage.getItem("currentUser"));

    // Allow admin and staff users
    if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "staff")) {
        alert("Access denied. Admin or Staff privileges required.");
        window.location.href = "index.html";
        return false;
    }

    return true;
}

/**
 * Check if current user has permission to edit student data.
 * Rule: Staff and Admin can edit students.
 */
function canEditStudents() {
    return currentUser && (currentUser.role === "staff" || currentUser.role === "admin");
}

/**
 * Staff and Admin can delete a single student.
 */
function canDeleteStudents() {
    return currentUser && (currentUser.role === "staff" || currentUser.role === "admin");
}

/**
 * Admin removes students in bulk (whole class) instead of one by one.
 */
function canBulkDeleteStudents() {
    return currentUser && currentUser.role === "admin";
}

function escapeStudentDetail(value) {
    return String(value || "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

/**
 * Load and display user info.
 * Also applies role-based UI restrictions:
 *   - Staff: year filter hidden and locked to their assigned year.
 *   - Admin: year filter visible with all options.
 */
function loadUserInfo() {
    if (!checkAuth()) return;

    const userInfoElem = document.getElementById("userInfo");
    if (userInfoElem) {
        const username = currentUser.name || currentUser.username || "user";
        const role = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
        userInfoElem.innerText = currentUser.role === "admin" ? "Administrator" : `${role}: ${username}`;
    }

    // ── YEAR FILTER — role-based visibility ─────────────────────────────────
    const yearFilterRow = document.querySelector('[id="dataYear"]')?.closest('div[style]') ||
                          document.getElementById('dataYear')?.parentElement;

    if (currentUser.role === 'staff') {
        // Hide the year dropdown and its entire row — staff cannot change it
        const dataYearEl = document.getElementById('dataYear');
        if (dataYearEl) {
            // Hide the containing toolbar div (label + select + buttons row)
            const toolbarRow = dataYearEl.closest('div');
            if (toolbarRow) toolbarRow.style.display = 'none';

            // Lock the value to the staff's assigned year
            const staffYear = String(currentUser.year || '');
            if (staffYear && staffYear !== 'All') {
                dataYearEl.value = staffYear;
            }
        }
    }
    // Admin: year filter stays visible (default state from HTML) — no change needed
    // ────────────────────────────────────────────────────────────────────────

    // Set page title and access indicator based on user role
    const pageTitle = document.getElementById("pageTitle");
    const backToAdminBtns = document.querySelectorAll('button[onclick="goBackToAdmin()"]');
    const departmentSelectionTitle = document.querySelector('#departmentSelection h4');

    if (currentUser && currentUser.role === "admin") {
        if (pageTitle) {
            pageTitle.innerHTML = `Students Data <span style="display: inline-block; font-size: 13px; font-weight: 600; background: #0284c7; color: white; padding: 4px 12px; border-radius: 12px; margin-left: 8px;">🛠️ Admin Mode</span>`;
        }
        backToAdminBtns.forEach(btn => btn.textContent = "Back to Admin Panel");
        if (departmentSelectionTitle) departmentSelectionTitle.textContent = "Select Department to View & Manage Students:";
    } else if (canEditStudents()) {
        if (pageTitle) {
            pageTitle.innerHTML = `Manage Students Data <span style="display: inline-block; font-size: 13px; font-weight: 600; background: #198754; color: white; padding: 4px 12px; border-radius: 12px; margin-left: 8px;">✏️ Staff (Edit Mode)</span>`;
        }
        backToAdminBtns.forEach(btn => btn.textContent = "Back to Dashboard");
        if (departmentSelectionTitle) departmentSelectionTitle.textContent = "Select Department to View & Edit Students:";
    } else {
        if (pageTitle) {
            pageTitle.innerHTML = `Students Data <span style="display: inline-block; font-size: 13px; font-weight: 600; background: #64748b; color: white; padding: 4px 12px; border-radius: 12px; margin-left: 8px;">👁️ View Only</span>`;
        }
        backToAdminBtns.forEach(btn => btn.textContent = "Back to Dashboard");
        if (departmentSelectionTitle) departmentSelectionTitle.textContent = "Select Department to View Students:";
    }

    const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
    if (bulkDeleteBtn) {
        bulkDeleteBtn.style.display = canBulkDeleteStudents() ? "inline-block" : "none";
    }
}

/**
 * Load data from the backend API, scoped to the user's role.
 * Staff: year is locked server-side; we still pass it as a hint.
 * Admin: may optionally pass year via the UI dropdown.
 */
async function loadData() {
    const token = localStorage.getItem('token');
    if (!token) {
        students = [];
        filteredStudents = [];
        const messageArea = document.getElementById('messageArea');
        if (messageArea) messageArea.textContent = 'Authentication is required to load current student records.';
        return false;
    }

    try {
        let studentsUrl = `${BASE_URL}/students`;
        const params = new URLSearchParams();
        if (currentUser && currentUser.role === 'staff') {
            if (currentUser.department) params.set('department', currentUser.department);
            if (currentUser.year && currentUser.year !== 'All') params.set('year', currentUser.year);
        } else if (currentUser && currentUser.role === 'admin') {
            const yearSel = document.getElementById('dataYear');
            const selectedYear = yearSel ? yearSel.value.trim() : '';
            if (selectedYear) params.set('year', selectedYear);
        }
        if ([...params].length) studentsUrl += '?' + params.toString();

        const response = await fetch(studentsUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.students)) {
            throw new Error(data.message || 'Unable to load current student records from MongoDB');
        }

        students = data.students;
        if (currentUser && currentUser.role === 'staff' &&
            currentUser.year && currentUser.year !== 'All') {
            students = students.filter(student => String(student.year) === String(currentUser.year));
        }
        return true;
    } catch (error) {
        console.error('Error fetching current student records:', error);
        students = [];
        filteredStudents = [];
        const messageArea = document.getElementById('messageArea');
        if (messageArea) messageArea.textContent = 'Unable to load current student records from MongoDB. Please check the server and try again.';
        return false;
    }
}

/**
 * Save data to localStorage
 */
function saveData() {
    localStorage.setItem("students", JSON.stringify(students));
}

/**
 * Generate department dropdown options
 */
function generateDepartmentCards() {
    const departmentDropdown = document.getElementById("departmentDropdown");
    departmentDropdown.innerHTML = "";

    Object.keys(departments).forEach(deptKey => {
        const dept = departments[deptKey];
        
        // Count students in this department
        const deptStudents = students.filter(s => 
            s.department && s.department.trim().toLowerCase() === deptKey.toLowerCase()
        );

        const dropdownItem = document.createElement("div");
        dropdownItem.className = "dropdown-item";
        dropdownItem.onclick = () => selectDepartmentFromDropdown(deptKey);
        
        dropdownItem.innerHTML = `
            <div class="dropdown-dept-info">
                <span class="dropdown-icon">${dept.icon}</span>
                <span class="dropdown-dept-name">${dept.name}</span>
            </div>
            <div class="dropdown-student-count">${deptStudents.length} Students</div>
        `;

        departmentDropdown.appendChild(dropdownItem);
    });
}

/**
 * Toggle dropdown open/close
 */
function toggleDropdown() {
    const dropdown = document.getElementById("departmentDropdown");
    const arrow = document.querySelector(".dropdown-arrow");
    
    dropdown.classList.toggle("open");
    arrow.classList.toggle("rotated");
}

/**
 * Close dropdown when clicking outside
 */
document.addEventListener('click', function(event) {
    const dropdownContainer = document.querySelector('.dropdown-container');
    if (!dropdownContainer.contains(event.target)) {
        const dropdown = document.getElementById("departmentDropdown");
        const arrow = document.querySelector(".dropdown-arrow");
        
        dropdown.classList.remove("open");
        arrow.classList.remove("rotated");
    }
});

/**
 * Select department from dropdown
 */
function selectDepartmentFromDropdown(department) {
    // Close dropdown
    const dropdown = document.getElementById("departmentDropdown");
    const arrow = document.querySelector(".dropdown-arrow");
    dropdown.classList.remove("open");
    arrow.classList.remove("rotated");
    
    // Update selected text
    const selectedText = document.getElementById("selectedDeptText");
    selectedText.textContent = departments[department].icon + " " + departments[department].name;
    
    // Proceed with selection
    selectDepartment(department);
}

/**
 * Select a department and show students
 */
function selectDepartment(department) {
    selectedDepartment = department;
    
    // Hide department selection and show students view
    document.getElementById("departmentSelection").style.display = "none";
    document.getElementById("studentsDataView").style.display = "block";
    
    // Update selected department info
    document.getElementById("selectedDeptInfo").innerHTML = `
        ${departments[department].icon} ${departments[department].name} Department
    `;
    
    // Reset year filter
    document.getElementById("dataYear").value = "";
    
    // Load students for this department
    loadStudentsForDepartment();
}

/**
 * Load students for selected department.
 * For staff: year is always locked to their assigned year — the dropdown
 * value is ignored even if somehow changed in the DOM.
 */
function loadStudentsForDepartment() {
    let yearFilter;

    if (currentUser && currentUser.role === 'staff' &&
        currentUser.year && currentUser.year !== 'All') {
        // Staff year is locked — never read from the dropdown
        yearFilter = String(currentUser.year);
    } else {
        // Admin reads from the dropdown
        yearFilter = document.getElementById("dataYear").value.trim();
    }

    // Filter students by department and program
    filteredStudents = students.filter(s => {
        const matchDept = s.department && s.department.trim().toLowerCase() === selectedDepartment.toLowerCase();
        const sProg = String(s.program || (s.classId && s.classId.startsWith('PG') ? 'PG' : 'UG')).toUpperCase();
        const matchProg = !selectedProgram || sProg === selectedProgram.toUpperCase();
        return matchDept && matchProg;
    });

    // Apply year filter
    if (yearFilter) {
        filteredStudents = filteredStudents.filter(s =>
            String(s.year).trim() === String(yearFilter)
        );
    }

    // Sort by roll number in ascending numeric order
    filteredStudents = sortStudentsByRollNumber(filteredStudents);

    displayStudentsTable();
}

/**
 * Called when Admin changes the Academic Year dropdown.
 * Re-fetches data from the backend filtered to the new year selection,
 * then re-renders the student table for the current department.
 */
async function adminYearChanged() {
    if (!currentUser || currentUser.role !== 'admin') return;
    // Re-load data with the new year filter, then refresh the table
    if (!await loadData()) return;
    if (selectedDepartment) {
        loadStudentsForDepartment();
    }
    generateDepartmentCards();
}

/**
 * Apply year filter (button click — re-renders without re-fetching)
 */
function applyYearFilter() {
    loadStudentsForDepartment();
}

/**
 * Display students in table
 */
function displayStudentsTable() {
    const tbody = document.getElementById("studentsBody");
    const statsDiv = document.getElementById("studentsStats");
    const messageArea = document.getElementById("messageArea");

    tbody.innerHTML = "";
    messageArea.innerHTML = "";

    if (filteredStudents.length === 0) {
        const yearFilter = currentUser && currentUser.role === 'staff' && currentUser.year !== 'All'
            ? currentUser.year
            : document.getElementById("dataYear").value.trim();
        const yearText = yearFilter ? ` - Year ${yearFilter}` : "";
        statsDiv.innerHTML = `<span style="color: #ffeb3b;">⚠️ No students found for ${selectedDepartment}${yearText}</span>`;
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: #ffeb3b;">No student records found. Please upload or register students first.</td></tr>`;
        return;
    }

    // Display statistics
    const yearFilter = currentUser && currentUser.role === 'staff' && currentUser.year !== 'All'
        ? currentUser.year
        : document.getElementById("dataYear").value.trim();
    const yearText = yearFilter ? ` - Year ${yearFilter}` : "";
    statsDiv.innerHTML = `Showing Students: <strong>${selectedDepartment}${yearText}</strong> (Total: <strong>${filteredStudents.length}</strong> students)`;

    // Display students in table
    filteredStudents.forEach((student, index) => {
        const displaySerial = index + 1; // Position in roll-number sorted order
        const studentId = student.studentId || student.id;
        const studentName = student.studentName || student.name;
        
        // Get initials for placeholder
        const initials = getInitials(studentName);
        
        // Photo cell HTML
        let photoHTML = '';
        if (student.photo) {
            photoHTML = `<img src="${student.photo}" alt="${studentName}" class="student-photo" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';">
                        <div class="student-photo-placeholder" style="display:none;">${initials}</div>`;
        } else {
            photoHTML = `<div class="student-photo-placeholder">No Photo</div>`;
        }

        const isEditable = canEditStudents();
        const isDeletable = canDeleteStudents();
        let actionCellHTML = "";

        if (isEditable || isDeletable) {
            const editButton = isEditable ? `
                    <button style="background-color: #f59e0b; color: white; padding: 5px 12px; font-size: 12px; font-weight: 600; border: none; border-radius: 4px; cursor: pointer;" onclick='openEditStudentModal(${JSON.stringify(student).replace(/'/g, "&#39;")})'>
                        ✏️ Edit
                    </button>` : '';
            const safeName = (studentName || '').replace(/'/g, "\\'");
            const safeProg = student.program || selectedProgram || 'UG';
            const deleteButton = isDeletable ? `
                    <button class="red" style="padding: 5px 10px; font-size: 12px; font-weight: 600; border: none; border-radius: 4px; cursor: pointer;" onclick="deleteSingleStudent('${studentId}', '${safeName}', '${student.department}', '${student.year}', '${safeProg}')">
                        🗑️ Delete
                    </button>` : '';

            actionCellHTML = `
                <div style="display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap;">
                    ${editButton}
                    ${deleteButton}
                </div>
            `;
        } else {
            actionCellHTML = `
                <span style="color: #cbd5e1; font-size: 12px; font-style: italic; background: rgba(255,255,255,0.12); padding: 4px 10px; border-radius: 4px; display: inline-block;">
                    👁️ Read Only
                </span>
            `;
        }

        tbody.innerHTML += `
            <tr>
                <td>${displaySerial}</td>
                <td style="text-align: center;">${photoHTML}</td>
                <td><strong>${studentId}</strong></td>
                <td>${studentName}</td>
                <td>${student.department}</td>
                <td><strong>${student.program || selectedProgram || 'UG'}</strong></td>
                <td>Year ${student.year} (${student.classId || (student.program === 'PG' ? 'PGCS' + student.year : 'CS' + student.year)})</td>
                <td style="text-align: center;">
                    <button class="view-details-btn" onclick='viewStudentDetails(${JSON.stringify(student).replace(/'/g, "&#39;")})'>
                        View Details
                    </button>
                </td>
                <td style="text-align: center;">
                    ${actionCellHTML}
                </td>
            </tr>
        `;
    });

    messageArea.innerHTML = '<span style="color: #51cf66;">✅ Students data loaded successfully.</span>';
}

/**
 * Get initials from name
 */
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * View full student details in modal
 */
function viewStudentDetails(student) {
    const modal = document.getElementById('studentDetailsModal');
    const detailsContainer = document.getElementById('modalStudentDetails');
    
    const studentId = student.studentId || student.id;
    const studentName = student.studentName || student.name;
    const initials = getInitials(studentName);
    
    // Photo HTML for modal
    let photoHTML = '';
    if (student.photo) {
        photoHTML = `<img src="${student.photo}" alt="${studentName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="placeholder-large" style="display:none;">${initials}</div>`;
    } else {
        photoHTML = `<div class="placeholder-large">No Photo</div>`;
    }
    
    // Format date if available
    const formatDate = (dateString) => {
        if (!dateString) return 'Not provided';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    
    detailsContainer.innerHTML = `
        <div class="student-photo-large">
            ${photoHTML}
        </div>
        <div class="student-info-details">
            <div class="detail-row">
                <div class="detail-label">📝 Register Number</div>
                <div class="detail-value">${studentId || 'N/A'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">👤 Student Name</div>
                <div class="detail-value">${studentName || 'N/A'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">🏢 Department</div>
                <div class="detail-value">${student.department || 'N/A'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">📅 Year</div>
                <div class="detail-value">Year ${student.year || 'N/A'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">📧 Email</div>
                <div class="detail-value">${student.email || 'Not provided'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">📱 Phone</div>
                <div class="detail-value">${student.phone || 'Not provided'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">🎂 Date of Birth</div>
                <div class="detail-value">${formatDate(student.dateOfBirth)}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">🏠 Address</div>
                <div class="detail-value">${student.address || 'Not provided'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">👨‍👩‍👦 Parent Name</div>
                <div class="detail-value">${student.parentName || 'Not provided'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">☎️ Parent Phone</div>
                <div class="detail-value">${student.parentPhone || 'Not provided'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Parent Relationship</div>
                <div class="detail-value">${escapeStudentDetail(student.parentRelationship || 'Not provided')}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Parent SMS Opt-out</div>
                <div class="detail-value">${student.parentSmsOptOut === true ? 'Opted out' : 'Not opted out'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">✅ Status</div>
                <div class="detail-value" style="color: ${student.status === 'active' ? '#51cf66' : '#ff6b6b'};">
                    ${student.status ? student.status.toUpperCase() : 'ACTIVE'}
                </div>
            </div>
        </div>
    `;
    
    // Add action buttons based on permission
    const isEditable = canEditStudents();
    const isDeletable = canDeleteStudents();
    const safeName = (studentName || '').replace(/'/g, "\\'");
    const safeProg = student.program || selectedProgram || 'UG';

    const editBtnHTML = isEditable ? `<button onclick="openEditStudentModal(${JSON.stringify(student).replace(/'/g, "&#39;")});" style="background-color:#f59e0b;color:white;padding:8px 16px;margin-right:8px;border:none;border-radius:4px;cursor:pointer;">✏️ Edit</button>` : '';
    const deleteBtnHTML = isDeletable ? `<button onclick="deleteSingleStudent('${studentId}', '${safeName}', '${student.department}', '${student.year}', '${safeProg}');" style="background-color:#dc2626;color:white;padding:8px 16px;border:none;border-radius:4px;cursor:pointer;">🗑️ Delete Student</button>` : '';

    if (editBtnHTML || deleteBtnHTML) {
        detailsContainer.innerHTML += `
            <div style="width:100%; margin-top:25px; text-align:center; border-top:1px solid rgba(255,255,255,0.25); padding-top:15px;">
                ${editBtnHTML}
                ${deleteBtnHTML}
            </div>
        `;
    } else {
        detailsContainer.innerHTML += `
            <div style="width:100%; margin-top:20px; text-align:center; color:#cbd5e1; font-size:13px; font-style:italic; border-top:1px solid rgba(255,255,255,0.2); padding-top:15px;">
                👁️ View Only Access
            </div>
        `;
    }

    if (currentUser && currentUser.role === "admin" && student._id) {
        const optOutSection = document.createElement("div");
        optOutSection.style.cssText = "width:100%;margin-top:20px;text-align:left;border-top:1px solid rgba(255,255,255,0.25);padding-top:15px;";

        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:8px;color:white;";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = student.parentSmsOptOut === true;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode("Parent has opted out of attendance SMS"));

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Save SMS preference";
        button.style.cssText = "background:#2563eb;color:white;padding:8px 14px;margin-top:10px;border:0;border-radius:6px;cursor:pointer;";
        button.addEventListener("click", () => saveParentSmsOptOut(student._id, checkbox.checked, button));

        const note = document.createElement("div");
        note.textContent = "Changing this preference does not send an SMS. Use Parent Notification History to send eligible skipped messages.";
        note.style.cssText = "margin-top:8px;color:#e2e8f0;font-size:12px;";
        optOutSection.append(label, button, note);
        detailsContainer.appendChild(optOutSection);
    }
    
    modal.style.display = 'block';
}

async function saveParentSmsOptOut(studentMongoId, parentSmsOptOut, button) {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Only an administrator can update the parent SMS opt-out.");
        return;
    }

    button.disabled = true;
    try {
        const response = await fetch(`${BASE_URL}/students/${encodeURIComponent(studentMongoId)}/parent-sms-opt-out`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`
            },
            body: JSON.stringify({ parentSmsOptOut })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Failed to update parent SMS preference");
        }

        [students, filteredStudents].forEach(list => {
            const student = list.find(item => String(item._id) === String(studentMongoId));
            if (student) student.parentSmsOptOut = data.parentSmsOptOut;
        });
        saveData();
        alert(data.message);
    } catch (error) {
        console.error("saveParentSmsOptOut error:", error);
        alert(error.message);
    } finally {
        button.disabled = false;
    }
}

/**
 * Close student details modal
 */
function closeStudentModal() {
    const modal = document.getElementById('studentDetailsModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Open edit modal for student (Staff Only)
 */
function openEditStudentModal(student) {
    if (!canEditStudents()) {
        alert("Access denied: You are not authorized to edit student records.");
        return;
    }

    const studentId = student.studentId || student.id || "";
    const studentName = student.studentName || student.name || "";

    document.getElementById("editOriginalId").value = studentId;
    document.getElementById("editStudentId").value = studentId;
    document.getElementById("editStudentName").value = studentName;
    document.getElementById("editDepartment").value = student.department || selectedDepartment || "Computer Science";
    document.getElementById("editYear").value = String(student.year || "1");
    document.getElementById("editEmail").value = student.email || "";
    document.getElementById("editPhone").value = student.phone || "";
    document.getElementById("editDob").value = student.dateOfBirth ? String(student.dateOfBirth).split("T")[0] : "";
    document.getElementById("editStatus").value = student.status || "active";
    document.getElementById("editParentName").value = student.parentName || "";
    document.getElementById("editParentPhone").value = student.parentPhone || "";
    document.getElementById("editParentRelationship").value = student.parentRelationship || "";
    document.getElementById("editPhoto").value = student.photo || "";
    document.getElementById("editAddress").value = student.address || "";

    const fileInput = document.getElementById("editPhotoFile");
    if (fileInput) fileInput.value = "";

    if (student.photo) {
        setPhotoPreview(student.photo, "Current Photo");
    } else {
        setPhotoPreview(null);
    }

    const modal = document.getElementById("editStudentModal");
    if (modal) modal.style.display = 'block';
}

/**
 * Handle image file selection from the system/computer
 * Compresses and converts to Base64 data URL for storage and preview
 */
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("Please select a valid image file (JPG, PNG, WEBP, GIF)");
        return;
    }

    const statusText = document.getElementById('photoStatusText');
    if (statusText) statusText.textContent = `Loading ${file.name}...`;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Resize to max 300x300 for crisp thumbnail and optimal storage
            const maxDimension = 300;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);

            document.getElementById('editPhoto').value = compressedBase64;
            setPhotoPreview(compressedBase64, `Loaded: ${file.name}`);
        };
        img.onerror = function() {
            alert("Failed to load image file. Please try another image.");
            setPhotoPreview(null);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Update photo preview thumbnail and status
 */
function setPhotoPreview(src, label) {
    const previewImg = document.getElementById('photoPreviewImg');
    const placeholder = document.getElementById('photoPreviewPlaceholder');
    const statusText = document.getElementById('photoStatusText');

    if (!previewImg || !placeholder || !statusText) return;

    if (src) {
        previewImg.src = src;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
        statusText.textContent = label || "Photo attached from system";
        statusText.style.color = "#86efac";
    } else {
        previewImg.src = "";
        previewImg.style.display = 'none';
        placeholder.style.display = 'flex';
        statusText.textContent = "No image chosen yet";
        statusText.style.color = "#e2e8f0";
    }
}

/**
 * Remove selected photo
 */
function clearPhoto() {
    const photoInput = document.getElementById('editPhoto');
    const fileInput = document.getElementById('editPhotoFile');
    if (photoInput) photoInput.value = "";
    if (fileInput) fileInput.value = "";
    setPhotoPreview(null);
}

/**
 * Close edit student modal
 */
function closeEditModal() {
    const modal = document.getElementById("editStudentModal");
    if (modal) modal.style.display = 'none';
}

/**
 * Save updated student changes (Staff Only)
 * Persists to MongoDB via PUT /api/students/:_id, then updates the local cache.
 */
async function saveStudentChanges() {
    if (!canEditStudents()) {
        alert("Access denied: You do not have permission to edit student records.");
        return;
    }

    const originalId = (document.getElementById("editOriginalId").value || "").trim();
    const newId = (document.getElementById("editStudentId").value || "").trim().toUpperCase();
    const newName = (document.getElementById("editStudentName").value || "").trim();
    const email = (document.getElementById("editEmail").value || "").trim();
    const phone = (document.getElementById("editPhone").value || "").trim();
    const dob = (document.getElementById("editDob").value || "").trim();
    const status = (document.getElementById("editStatus").value || "active").trim();
    const parentName = (document.getElementById("editParentName").value || "").trim();
    const parentPhone = (document.getElementById("editParentPhone").value || "").trim();
    const parentRelationship = (document.getElementById("editParentRelationship").value || "").trim();
    const photo = (document.getElementById("editPhoto").value || "").trim();
    const address = (document.getElementById("editAddress").value || "").trim();

    if (!newId || !newName) {
        alert("Register Number and Student Name are required.");
        return;
    }

    // Locate the student in memory to get MongoDB _id
    const studentIndex = students.findIndex(s => {
        const sId = (s.studentId || s.id || "").trim().toLowerCase();
        return sId === originalId.toLowerCase();
    });

    if (studentIndex === -1) {
        alert("Student record is not loaded from MongoDB. Reload the page before updating.");
        return;
    }

    const existingStudent = students[studentIndex];

    const token = localStorage.getItem("token");
    const mongoId = existingStudent._id;
    if (!token || !mongoId) {
        alert("An authenticated MongoDB student record is required to save changes.");
        return;
    }

    try {
        const payload = {
            studentName: newName,
            studentId: newId,
            email, phone, address, photo,
            dateOfBirth: dob || undefined,
            parentName, parentPhone, parentRelationship, status
        };
        Object.keys(payload).forEach(k => {
            if (k !== "photo" && (payload[k] === undefined || payload[k] === null || payload[k] === "")) delete payload[k];
        });
        const response = await fetch(`${BASE_URL}/students/${mongoId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            alert(`Failed to save to database: ${data.message || "Unknown error"}`);
            return;
        }
        students[studentIndex] = { ...existingStudent, ...(data.student || {}) };
    } catch (err) {
        console.error("saveStudentChanges API error:", err);
        alert(`Network error saving changes: ${err.message}`);
        return;
    }

    saveData();
    closeEditModal();
    alert(`✅ Student "${newName}" (${newId}) updated successfully!`);

    generateDepartmentCards();
    if (selectedDepartment) {
        loadStudentsForDepartment();
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const detailsModal = document.getElementById('studentDetailsModal');
    const editModal = document.getElementById('editStudentModal');
    if (event.target === detailsModal) {
        detailsModal.style.display = 'none';
    }
    if (event.target === editModal) {
        editModal.style.display = 'none';
    }
}

/**
 * Delete a single student
 */
async function deleteSingleStudent(studentId, studentName, department, year, program) {
    if (!canDeleteStudents()) {
        alert("Access denied: You are not authorized to delete students.");
        return;
    }

    if (!confirm(`Are you sure you want to delete student:\n\n• Name: ${studentName}\n• ID: ${studentId}\n• Class: ${department} - Year ${year}\n\nThis will also remove their attendance records.`)) {
        return;
    }

    const token = localStorage.getItem('token');
    if (token) {
        try {
            const prog = program || selectedProgram || 'UG';
            const scopeQuery = `department=${encodeURIComponent(department || '')}&year=${encodeURIComponent(year || '')}&program=${encodeURIComponent(prog)}`;
            const response = await fetch(`${BASE_URL}/students/${encodeURIComponent(studentId)}?${scopeQuery}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok && data.success) {
                alert(`✅ ${data.message}`);
                // Close the details modal if open
                closeStudentModal();
                // Reload from backend
                if (!await loadData()) return;
                generateDepartmentCards();
                if (selectedDepartment) {
                    loadStudentsForDepartment();
                }
            } else {
                alert(`❌ Failed to delete: ${data.message || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Delete student error:', err);
            alert(`❌ Network error: ${err.message}`);
        }
    } else {
        alert('Authentication required. Please log in again.');
    }
}

/**
 * Delete every student of the selected class (department + year) from MongoDB.
 * Admin only. Attendance records and photos are removed with the students.
 */
async function deleteAllClassStudents() {
    if (!canBulkDeleteStudents()) {
        alert("Access denied: only the Admin can delete a whole class.");
        return;
    }

    if (!selectedDepartment) {
        alert("Please select a department first.");
        return;
    }

    if (!await loadData()) return;
    loadStudentsForDepartment();

    const yearFilter = document.getElementById("dataYear").value.trim();
    const yearText = yearFilter ? `Year ${yearFilter}` : "ALL YEARS";
    const targets = filteredStudents;

    if (targets.length === 0) {
        alert("No students found for the selected class.");
        return;
    }

    const confirmMsg1 = `⚠️ WARNING: This permanently deletes:\n\n` +
        `• Department: ${selectedDepartment}\n` +
        `• Year: ${yearText}\n` +
        `• Total Students: ${targets.length}\n\n` +
        `All student records and attendance history will be removed from the DATABASE.\n\n` +
        `Do you want to continue?`;

    if (!confirm(confirmMsg1)) return;

    const confirmMsg2 = `FINAL CONFIRMATION:\n\n` +
        `Delete ALL ${targets.length} students of ${selectedDepartment} (${yearText})?\n\n` +
        `This action CANNOT be undone!`;

    if (!confirm(confirmMsg2)) return;

    const token = localStorage.getItem("token");
    if (!token) {
        alert("Authentication required. Please log in again.");
        return;
    }

    try {
        const response = await fetch(`${BASE_URL}/reports/class`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ department: selectedDepartment, year: yearFilter || 'All' })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            alert(`❌ Failed to delete class: ${data.message || 'Unknown error'}`);
            return;
        }

        // Refresh from MongoDB so the table, cards and cache all agree
        if (!await loadData()) {
            alert("Class deletion succeeded, but current student records could not be reloaded.");
            return;
        }
        saveData();
        generateDepartmentCards();
        loadStudentsForDepartment();

        alert(`✅ Deletion completed.\n\n` +
            `• Students deleted: ${data.deletedStudents}\n` +
            `• Attendance records deleted: ${data.deletedAttendance}`);
    } catch (err) {
        console.error('Bulk delete error:', err);
        alert(`❌ Network error: ${err.message}`);
    }
}

/**
 * Download students data as PDF
 */
async function downloadStudentsData() {
    const messageArea = document.getElementById('messageArea');
    if (!selectedDepartment || !filteredStudents.length) {
        if (messageArea) messageArea.textContent = 'Select a class with student records before downloading.';
        return;
    }
    try {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF library not loaded. Refresh the page and try again.');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const width = doc.internal.pageSize.width, center = width / 2;
        const year = document.getElementById('dataYear').value.trim();
        const classId = year ? `${selectedProgram === 'PG' ? 'PGCS' : 'CS'}${year}` : `All ${selectedProgram} Classes`;
        const academicYear = year ? (year === '1' ? '1st Year' : year === '2' ? '2nd Year' : '3rd Year') : 'All Years';
        const pageMargin = 8;
        const collegeName = 'THANTHAI HANS ROEVER COLLEGE (AUTONOMOUS)';
        doc.setTextColor(20,45,85); doc.setFontSize(17); doc.setFont(undefined,'bold'); doc.text(collegeName,center,14,{align:'center'});
        try {
            const logoElement = document.querySelector('.header-logo-left img');
            if (logoElement && logoElement.complete && logoElement.naturalWidth > 0) {
                const canvas = document.createElement('canvas');
                canvas.width = logoElement.naturalWidth;
                canvas.height = logoElement.naturalHeight;
                canvas.getContext('2d').drawImage(logoElement,0,0);
                const logoData = canvas.toDataURL('image/png');
                const logoWidth = 17, logoHeight = 17;
                const titleWidth = doc.getTextWidth(collegeName);
                const logoY = 5;
                const leftLogoX = center-titleWidth/2-logoWidth-4;
                doc.addImage(logoData,'PNG',leftLogoX,logoY,logoWidth,logoHeight,undefined,'FAST');
                const hansImage = new Image();
                hansImage.src = 'img/Hans.png';
                await new Promise((resolve, reject) => {
                    hansImage.onload = resolve;
                    hansImage.onerror = reject;
                });
                const hansCanvas = document.createElement('canvas');
                hansCanvas.width = hansImage.naturalWidth;
                hansCanvas.height = hansImage.naturalHeight;
                hansCanvas.getContext('2d').drawImage(hansImage,0,0);
                doc.addImage(hansCanvas.toDataURL('image/png'),'PNG',center+titleWidth/2+4,logoY,logoWidth,logoHeight,undefined,'FAST');
            }
        } catch (logoError) {
            console.warn('College logo could not be added to Student Data PDF:',logoError);
        }
        doc.setFontSize(10); doc.setFont(undefined,'normal'); doc.text('(Affiliated to Bharathidasan University)',center,20,{align:'center'});
        doc.text("Accredited with 'A' Grade by NAAC (3rd cycle) with CGPA 3.23 out of 4",center,25,{align:'center'}); doc.text('ELAMBALUR (P.O), PERAMBALUR - 621 220',center,30,{align:'center'});
        doc.setDrawColor(20,45,85); doc.line(pageMargin,33,width-pageMargin,33); doc.setFillColor(28,78,145); doc.rect(pageMargin,35,width-pageMargin*2,10,'F');
        doc.setTextColor(255); doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.text('STUDENT DATA',center,42,{align:'center'});
        doc.setTextColor(0); doc.setFillColor(221,239,250); doc.rect(pageMargin,46,width-pageMargin*2,18,'F'); doc.setFontSize(10); doc.setFont(undefined,'normal');
        doc.text(`Programme: ${selectedProgram}   Department: ${selectedDepartment}   Academic Year: ${academicYear}   Class: ${classId}`,pageMargin+4,53);
        doc.text(`Total Students: ${filteredStudents.length}   Generated: ${new Date().toLocaleString('en-IN')}`,pageMargin+4,60);
        const headers=['S.No','Roll No','Student Name','Academic Year','Gender','DOB','Student Mobile No.','Parent / Guardian Name','Parent / Guardian Mobile No.','UMIS ID','ABC ID','Day Scholar / Hosteller','Address','Photo'];
        const rows=filteredStudents.map((s,i)=>[String(i+1),s.studentId||s.id||'—',s.studentName||s.name||'—',s.academicYear||academicYear,s.gender||'—',s.dateOfBirth?new Date(s.dateOfBirth).toLocaleDateString('en-IN'):'—',s.phone||'—',s.parentName||'—',s.parentPhone||'—',s.umisId||'—',s.abcId||'—',s.dayScholarHosteller||'—',s.address||'—',s.photoId||s.photo?'':'No Photo']);
        const photos=new Map(), token=localStorage.getItem('token');
        await Promise.all(filteredStudents.map(async s=>{if(!s.photoId&&!s.photo)return;try{let blob;if(s.photoId){const response=await fetch(`${BASE_URL}/students/${encodeURIComponent(s._id)}/photo`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('Photo unavailable');blob=await response.blob();}else{blob=await(await fetch(s.photo)).blob();}const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});if(data)photos.set(s._id,{data,type:blob.type==='image/png'?'PNG':'JPEG'});}catch(_){}}));
        doc.autoTable({head:[headers],body:rows,startY:67,theme:'grid',rowPageBreak:'avoid',styles:{fontSize:10,cellPadding:2.2,overflow:'linebreak',valign:'middle',lineColor:[0,0,0],lineWidth:0.2},headStyles:{fillColor:[205,229,245],textColor:[0,0,0],fontSize:11,fontStyle:'bold',halign:'center',cellPadding:2.5},margin:{top:18,left:pageMargin,right:pageMargin,bottom:12},columnStyles:{0:{cellWidth:10},1:{cellWidth:28},2:{cellWidth:42},3:{cellWidth:22},4:{cellWidth:16},5:{cellWidth:20},6:{cellWidth:27},7:{cellWidth:38},8:{cellWidth:34},9:{cellWidth:20},10:{cellWidth:20},11:{cellWidth:30},12:{cellWidth:70},13:{cellWidth:27,minCellHeight:26,halign:'center'}},didDrawCell:data=>{if(data.section!=='body'||data.column.index!==13)return;const s=filteredStudents[data.row.index],p=photos.get(s&&s._id);if(p)try{doc.addImage(p.data,p.type,data.cell.x+3,data.cell.y+3,21,20,undefined,'FAST');}catch(_){}}});
        const pages=doc.internal.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.text(`Page ${i} of ${pages}`,center,doc.internal.pageSize.height-5,{align:'center'});}
        doc.save(`${selectedProgram}_${classId.replace(/\s+/g,'_')}_Student_Data.pdf`);
        if(messageArea)messageArea.textContent='Student data PDF downloaded.';
    } catch(error) {
        console.error('PDF download error:',error); if(messageArea)messageArea.textContent=`PDF download failed: ${error.message}`;
    }
    return;
    {
    const table = document.getElementById("studentsTable");
    const messageArea = document.getElementById("messageArea");

    if (!selectedDepartment) {
        messageArea.innerHTML = '<span style="color: #ff6b6b;">Please select a department first.</span>';
        return;
    }

    const tbody = document.getElementById("studentsBody");
    if (!tbody || tbody.children.length === 0 || filteredStudents.length === 0) {
        messageArea.innerHTML = '<span style="color: #ff6b6b;">No data available to download.</span>';
        return;
    }

    try {
        // Check if jsPDF is available
        if (typeof window.jspdf === 'undefined') {
            throw new Error('PDF library not loaded. Please refresh the page and try again.');
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Create filename
        const deptName = selectedDepartment.replace(/\s+/g, "_");
        const yearFilter = document.getElementById("dataYear").value.trim();
        const yearText = yearFilter ? `Year ${yearFilter}` : "All Years";
        const filename = `Students_Data_${deptName}_${yearText.replace(/\s+/g, '_')}.pdf`;

        // Add title
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text('Students Data Report', 14, 15);
        
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.text(`Department: ${selectedDepartment}`, 14, 25);
        doc.text(`Year: ${yearText}`, 14, 32);
        doc.text(`Total Students: ${filteredStudents.length}`, 14, 39);

        // Table headers (excluding Photo, Full Details, and Action columns)
        const headers = ['S.No', 'Register No', 'Name', 'Department', 'Year', 'Email', 'Phone'];

        // Get table data
        const tableData = filteredStudents.map((student, index) => [
            index + 1,
            student.studentId || student.id || '',
            student.studentName || student.name || '',
            student.department || '',
            student.year || '',
            student.email || 'N/A',
            student.phone || 'N/A'
        ]);

        // Create table
        doc.autoTable({
            startY: 47,
            head: [headers],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [0, 123, 255],
                textColor: 255,
                fontStyle: 'bold',
                halign: 'center'
            },
            styles: {
                fontSize: 8,
                cellPadding: 2
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 12 },   // S.No
                1: { halign: 'center', cellWidth: 25 },   // Register No
                2: { halign: 'left', cellWidth: 40 },     // Name
                3: { halign: 'left', cellWidth: 35 },     // Department
                4: { halign: 'center', cellWidth: 15 },   // Year
                5: { halign: 'left', cellWidth: 35 },     // Email
                6: { halign: 'center', cellWidth: 25 }    // Phone
            }
        });

        // Add footer
        const pageCount = doc.internal.getNumberOfPages();
        const pageHeight = doc.internal.pageSize.height;
        
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setFont(undefined, 'normal');
            doc.text(
                `Generated on: ${new Date().toLocaleString()} | Page ${i} of ${pageCount}`,
                14,
                pageHeight - 10
            );
        }

        // Download PDF
        doc.save(filename);
        messageArea.innerHTML = '<span style="color: #51cf66;">✅ Students data downloaded as PDF successfully!</span>';

    } catch (error) {
        console.error("PDF download error:", error);
        messageArea.innerHTML = '<span style="color: #ff6b6b;">❌ Failed to download PDF: ' + error.message + '</span>';
    }
    }
}

/**
 * Go back to department selection
 */
function goBackToDepartments() {
    document.getElementById("studentsDataView").style.display = "none";
    document.getElementById("departmentSelection").style.display = "block";
    selectedDepartment = "";
    
    // Reset dropdown
    document.getElementById("selectedDeptText").textContent = "Choose Department";
    const dropdown = document.getElementById("departmentDropdown");
    const arrow = document.querySelector(".dropdown-arrow");
    dropdown.classList.remove("open");
    arrow.classList.remove("rotated");
    
    // Refresh department options (in case student counts changed)
    generateDepartmentCards();
}

/**
 * Go back to admin panel or home page based on user role
 */
function goBackToAdmin() {
    if (currentUser && currentUser.role === "admin") {
        window.location.href = "admin.html";
    } else {
        window.location.href = "home.html";
    }
}

/**
 * Initialize page when DOM is loaded
 */
document.addEventListener("DOMContentLoaded", async function() {
    loadUserInfo();
    await loadData();

    // Set page title based on user role
    const pageTitle = document.getElementById("pageTitle");
    if (currentUser && currentUser.role === "staff") {
        if (pageTitle) pageTitle.textContent = "My Students Data";
    }

    generateDepartmentCards();

    // Initialize Program buttons for Admin
    if (currentUser && currentUser.role === "admin") {
        selectProgramTab('UG');
    }

    // ── STAFF: auto-enter their department+year+program, bypass picker ──
    if (currentUser && currentUser.role === "staff" && currentUser.department) {
        const deptKey = currentUser.department;
        const staffProg = currentUser.program || (currentUser.classId && currentUser.classId.startsWith('PG') ? 'PG' : 'UG');
        selectedProgram = staffProg;

        // Hide program selector for staff
        const progContainer = document.getElementById("programSelectionContainer");
        if (progContainer) progContainer.style.display = "none";
        const legacySec = document.getElementById("legacyDeptDropdownSection");
        if (legacySec) legacySec.style.display = "none";

        if (currentUser.year && currentUser.year !== 'All') {
            const dataYearEl = document.getElementById("dataYear");
            if (dataYearEl) dataYearEl.value = String(currentUser.year);
        }

        selectClassFromButton(staffProg, currentUser.year, currentUser.classId);
    }
    // Admin: show the department picker (default behaviour, nothing to change)
});

/**
 * Handle logout (inherited from admin functionality)
 */
function logout() {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem("currentUser");
        localStorage.removeItem("token");
        window.location.href = "index.html";
    }
}
