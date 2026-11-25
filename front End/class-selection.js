/* ==========================================================================
   class-selection.js - Choose UG / PG Class after staff login
   UG: CS1, CS2, CS3
   PG: PGCS1, PGCS2
   ========================================================================== */

const BASE_URL = 'http://localhost:3000/api';

const CLASS_CONFIG = {
    CS1: {
        classId: 'CS1',
        program: 'UG',
        year: '1',
        title: 'UG 1st Year',
        desc: 'Computer Science 1st Year (CS1)',
        color: '#2563eb'
    },
    CS2: {
        classId: 'CS2',
        program: 'UG',
        year: '2',
        title: 'UG 2nd Year',
        desc: 'Computer Science 2nd Year (CS2)',
        color: '#28a745'
    },
    CS3: {
        classId: 'CS3',
        program: 'UG',
        year: '3',
        title: 'UG 3rd Year',
        desc: 'Computer Science 3rd Year (CS3)',
        color: '#7c3aed'
    },
    PGCS1: {
        classId: 'PGCS1',
        program: 'PG',
        year: '1',
        title: 'PG 1st Year',
        desc: 'Computer Science PG 1st Year (PGCS1)',
        color: '#0891b2'
    },
    PGCS2: {
        classId: 'PGCS2',
        program: 'PG',
        year: '2',
        title: 'PG 2nd Year',
        desc: 'Computer Science PG 2nd Year (PGCS2)',
        color: '#d97706'
    }
};

let selecting = false;

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem("currentUser")) || null;
    } catch (e) {
        return null;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const user = getStoredUser();

    if (!token || !user) {
        window.location.href = "index.html";
        return;
    }

    if (user.role === "admin") {
        window.location.href = "admin.html";
        return;
    }

    // A class is already active for this session
    if (user.role === "staff" && user.year && user.year !== "All" && user.classId) {
        window.location.href = "home.html";
        return;
    }

    // Determine whether this is a UG or PG user
    const username = (user.username || '').toLowerCase();
    const isPG = (user.program === 'PG') || username.startsWith('pg');
    const activeProgram = isPG ? 'PG' : 'UG';

    const staffNameEl = document.getElementById("staffName");
    const headingEl = document.getElementById("selectionHeading");
    if (staffNameEl) {
        staffNameEl.innerText = `Logged in as ${user.name || (activeProgram + " CS Staff")}`;
    }
    if (headingEl) {
        headingEl.innerText = `Select Your ${activeProgram} Class`;
    }

    renderClassButtons(activeProgram);
});

function renderClassButtons(program) {
    const container = document.getElementById("classButtonsContainer");
    if (!container) return;

    container.innerHTML = "";

    const availableClasses = program === 'PG'
        ? ['PGCS1', 'PGCS2']
        : ['CS1', 'CS2', 'CS3'];

    availableClasses.forEach(classId => {
        const info = CLASS_CONFIG[classId];
        if (!info) return;

        const btn = document.createElement("button");
        btn.setAttribute("onclick", `selectClass('${classId}')`);
        btn.style.cssText = `font-size: 16px; padding: 18px 28px; min-width: 220px; background-color: ${info.color}; color: white; cursor: pointer; border-radius: 8px; border: none; font-weight: bold; transition: transform 0.2s;`;
        btn.onmouseover = () => { btn.style.transform = 'translateY(-2px)'; };
        btn.onmouseout = () => { btn.style.transform = 'translateY(0)'; };

        btn.innerHTML = `${info.title}<br><span style="font-size: 13px; font-weight: normal; opacity: 0.9;">${info.desc}</span>`;
        container.appendChild(btn);
    });
}

async function selectClass(classId) {
    const info = CLASS_CONFIG[classId];
    const msgEl = document.getElementById("selectionMsg");

    if (!info || selecting) return;

    const token = localStorage.getItem("token");
    const user = getStoredUser();

    if (!token || !user) {
        window.location.href = "index.html";
        return;
    }

    selecting = true;

    if (msgEl) {
        msgEl.style.color = "#ffffff";
        msgEl.innerText = `Opening ${info.title} (${classId})...`;
    }

    // Offline mode fallback: keep local demo working if backend is offline
    if (token.startsWith("local-token-")) {
        const selectedUser = {
            ...user,
            name: `${info.program} CS Staff (Year ${info.year})`,
            year: info.year,
            program: info.program,
            classId: classId,
            selectedClass: classId
        };

        const offlineToken = info.program === 'PG' ? `local-token-pgcs${info.year}` : `local-token-cs${info.year}`;
        localStorage.setItem("token", offlineToken);
        localStorage.setItem("currentUser", JSON.stringify(selectedUser));
        localStorage.setItem("department", selectedUser.department || "Computer Science");
        localStorage.setItem("year", info.year);
        localStorage.setItem("program", info.program);
        localStorage.setItem("classId", classId);
        localStorage.removeItem("students");

        window.location.href = "home.html";
        return;
    }

    try {
        const response = await fetch(`${BASE_URL}/auth/select-class`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ classId })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.token) {
            if (msgEl) {
                msgEl.style.color = "#fca5a5";
                msgEl.innerText = data.message || "Unable to select class. Please try again.";
            }
            selecting = false;
            return;
        }

        const updatedUser = {
            ...data.user,
            program: data.user.program || info.program,
            classId: classId,
            selectedClass: classId
        };

        localStorage.setItem("token", data.token);
        localStorage.setItem("currentUser", JSON.stringify(updatedUser));
        localStorage.setItem("department", data.user.department || "Computer Science");
        localStorage.setItem("year", String(data.user.year));
        localStorage.setItem("program", updatedUser.program);
        localStorage.setItem("classId", classId);
        localStorage.removeItem("students");

        // Cache only this class's roster
        try {
            const studentsRes = await fetch(`${BASE_URL}/students`, {
                headers: { 'Authorization': `Bearer ${data.token}` }
            });
            if (studentsRes.ok) {
                const studentsData = await studentsRes.json();
                if (Array.isArray(studentsData.students)) {
                    localStorage.setItem("students", JSON.stringify(studentsData.students));
                }
            }
        } catch (e) {
            // Dashboard will sync when it opens
        }

        window.location.href = "home.html";
    } catch (error) {
        console.error("Select class failed:", error);
        if (msgEl) {
            msgEl.style.color = "#fca5a5";
            msgEl.innerText = "Cannot connect to server. Ensure the backend is running on port 5000.";
        }
        selecting = false;
    }
}

function logout() {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem("currentUser");
        localStorage.removeItem("token");
        localStorage.removeItem("department");
        localStorage.removeItem("year");
        localStorage.removeItem("program");
        localStorage.removeItem("classId");
        window.location.href = "index.html";
    }
}
