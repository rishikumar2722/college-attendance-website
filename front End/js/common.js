/* ==========================================================================
   common.js - Shared utilities, API client & session management
   ========================================================================== */

const BASE_URL = 'http://localhost:3000/api';

const departments = {
    cs: "Computer Science",
    it: "Information Technology",
    tam: "Tamil",
    eng: "English"
};

/**
 * Universal API Fetch Wrapper with JWT authorization and error handling
 */
async function apiFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const token = localStorage.getItem("token");

    const headers = {
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...options.headers
    };

    // If body is object and not FormData, stringify and add application/json
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            body
        });

        // Handle expired or unauthorized token
        if (response.status === 401) {
            console.warn("Session expired or unauthorized. Redirecting to login.");
            localStorage.removeItem("token");
            localStorage.removeItem("currentUser");
            if (!window.location.href.includes("index.html")) {
                window.location.href = "index.html";
            }
            return { ok: false, status: 401, message: "Session expired" };
        }

        const data = await response.json().catch(() => ({}));
        return {
            ok: response.ok,
            status: response.status,
            ...data
        };
    } catch (error) {
        console.error(`API Fetch Error (${endpoint}):`, error);
        return {
            ok: false,
            status: 0,
            message: "Unable to connect to backend server. Make sure server is running on port 5000."
        };
    }
}

/**
 * Retrieve current user session from localStorage
 */
function getCurrentUser() {
    return JSON.parse(localStorage.getItem("currentUser")) || null;
}

/**
 * Add the college identity block used on attendance report PDFs.
 */
async function addCollegePdfHeader(doc) {
    const collegeName = 'THANTHAI HANS ROEVER COLLEGE (AUTONOMOUS)';
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    const titleWidth = doc.getTextWidth(collegeName);

    try {
        const loadImage = src => new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                canvas.getContext('2d').drawImage(image, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            image.onerror = reject;
            image.src = src;
        });
        const [collegeLogo, hansPhoto] = await Promise.all([loadImage('logo.png'), loadImage('img/Hans.png')]);
        doc.addImage(collegeLogo, 'PNG', 105 - titleWidth / 2 - 21, 6, 17, 17, undefined, 'FAST');
        doc.addImage(hansPhoto, 'PNG', 105 + titleWidth / 2 + 4, 6, 17, 17, undefined, 'FAST');
    } catch (logoError) {
        console.warn('Report header images could not be added:', logoError);
    }

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(collegeName, 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('(Affiliated to Bharathidasan University)', 105, 22, { align: 'center' });
    doc.text("Accredited with 'A' Grade by NAAC (3rd cycle) with CGPA 3.23 out of 4", 105, 28, { align: 'center' });
    doc.text('ELAMBALUR (P.O), PERAMBALUR - 621 220', 105, 33, { align: 'center' });
}

/**
 * Global logout function
 */
function logout() {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem("currentUser");
        localStorage.removeItem("token");
        localStorage.removeItem("department");
        localStorage.removeItem("year");

        window.location.href = "index.html";
    }
}
