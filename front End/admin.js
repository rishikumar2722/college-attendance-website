/* ========================================================
   admin.js - JavaScript for admin.html
   ======================================================== */

const BASE_URL = 'http://localhost:5000/api';

/**
 * Check if user is authenticated and has admin privileges.
 * Redirects staff users to home.html and unauthenticated users to index.html.
 */
function checkAuth() {
    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem("currentUser"));
    } catch (e) {
        currentUser = null;
    }

    if (!currentUser) {
        window.location.href = "index.html";
        return null;
    }

    if (currentUser.role !== "admin") {
        alert("Access denied. Admin privileges required.");
        window.location.href = "home.html";
        return null;
    }

    return currentUser;
}

/**
 * Display the administrator role inside <h2 id="userInfo"></h2>
 */
function loadAdminInfo() {
    const currentUser = checkAuth();
    if (!currentUser) return;

    const userInfoElem = document.getElementById("userInfo");
    if (!userInfoElem) return;

    userInfoElem.innerText = "Administrator";
}

/**
 * Fetch and display total number of Pending requests on Admin dashboard
 */
async function loadPendingRequestsCount() {
    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${BASE_URL}/student-requests/pending`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const count = (data.summary && data.summary.pending !== undefined)
                ? data.summary.pending
                : (data.count !== undefined ? data.count : (data.requests ? data.requests.length : 0));

            const badge = document.getElementById("pendingBadge");
            if (badge) {
                badge.textContent = `${count} Pending`;
                badge.style.display = count > 0 ? "inline-block" : "none";
            }
        }
    } catch (e) {
        console.error("Failed to load pending requests count:", e);
    }
}

function addNotificationCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
    row.appendChild(cell);
    return cell;
}

async function loadNotificationHistory() {
    const message = document.getElementById("notificationsMessage");
    const body = document.getElementById("notificationHistoryBody");
    if (!body) return;

    body.replaceChildren();
    if (message) message.textContent = "Loading notification history...";

    try {
        const params = new URLSearchParams();
        const dateFrom = document.getElementById("notificationDateFrom").value;
        const dateTo = document.getElementById("notificationDateTo").value;
        const classId = document.getElementById("notificationClass").value;
        const department = document.getElementById("notificationDepartment").value;
        const status = document.getElementById("notificationStatus").value;
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        if (classId) params.set("classId", classId);
        if (department) params.set("department", department);
        if (status) params.set("status", status);

        const token = localStorage.getItem("token");
        const response = await fetch(`${BASE_URL}/notifications?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Unable to load parent notification history");
        }

        (data.notifications || []).forEach(notification => {
            const row = document.createElement("tr");
            addNotificationCell(row, notification.studentName);
            addNotificationCell(row, notification.studentId);
            addNotificationCell(row, notification.parentPhoneMasked);
            addNotificationCell(row, `${notification.department} / ${notification.classId}`);
            addNotificationCell(row, notification.attendanceDate);
            const latestAttempt = notification.statusHistory && notification.statusHistory.length
                ? notification.statusHistory[notification.statusHistory.length - 1].at
                : null;
            const notificationTime = latestAttempt || notification.sentAt || notification.createdAt;
            addNotificationCell(row, notificationTime
                ? new Date(notificationTime).toLocaleString("en-IN")
                : "");
            addNotificationCell(row, notification.eventType);
            addNotificationCell(row, notification.failureReason
                ? `${notification.status}: ${notification.failureReason}`
                : notification.status);
            const attemptHistory = (notification.statusHistory || []).map(entry => {
                const time = entry.at ? new Date(entry.at).toLocaleString("en-IN") : "";
                return `${entry.status}${entry.reason ? ` (${entry.reason})` : ""}${time ? ` — ${time}` : ""}`;
            }).join(" → ");
            addNotificationCell(row, attemptHistory);

            const actionCell = document.createElement("td");
            if (notification.canRetry) {
                const retryButton = document.createElement("button");
                retryButton.type = "button";
                retryButton.textContent = "Retry";
                retryButton.addEventListener("click", () => retryParentNotification(notification._id, retryButton));
                actionCell.appendChild(retryButton);
            } else {
                actionCell.textContent = "—";
            }
            row.appendChild(actionCell);
            body.appendChild(row);
        });

        if (message) {
            message.textContent = data.notifications && data.notifications.length
                ? `Showing ${data.notifications.length} notification record(s).`
                : "No notification records match these filters.";
        }
    } catch (error) {
        console.error("Notification history error:", error);
        if (message) message.textContent = error.message;
    }
}

async function retryParentNotification(notificationId, button) {
    const message = document.getElementById("notificationsMessage");
    button.disabled = true;
    if (message) message.textContent = "Retrying notification...";

    try {
        const token = localStorage.getItem("token");
        const response = await fetch(`${BASE_URL}/notifications/${encodeURIComponent(notificationId)}/retry`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Notification retry failed");
        }
        if (message) message.textContent = data.message;
        await loadNotificationHistory();
    } catch (error) {
        console.error("Notification retry error:", error);
        if (message) message.textContent = error.message;
        button.disabled = false;
    }
}

/**
 * Fetch and display total unread Staff messages on Admin dashboard
 */
async function loadUnreadMessageCount() {
    try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${BASE_URL}/messages/unread-count`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const count = data.unreadCount || 0;
            const badge = document.getElementById("msgUnreadBadge");
            if (badge) {
                badge.textContent = `${count} New`;
                badge.style.display = count > 0 ? "inline-block" : "none";
            }
        }
    } catch (e) {
        console.error("Failed to load unread message count:", e);
    }
}

/**
 * Delete student data for a specified Department and Year
 */
async function deleteClassData() {
    const dept = prompt("Enter Department to delete students from (e.g. Computer Science):");
    if (!dept) return;
    const year = prompt("Enter Year to delete (1, 2, or 3):");
    if (!year) return;

    if (confirm(`Are you sure you want to delete all students for ${dept} - Year ${year}?`)) {
        try {
            const token = localStorage.getItem("token");
            const response = await fetch(`${BASE_URL}/reports/class`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ department: dept.trim(), year: year.trim() })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                alert(`✅ Successfully deleted all students for ${dept} - Year ${year}.`);
            } else {
                alert(`❌ Failed to delete: ${data.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error("Delete class data error:", error);
            alert(`❌ Network error. Please check your connection. ${error.message}`);
        }
    }
}

/**
 * Logout: clear session and redirect to index.html.
 */
function logout() {
    if (confirm("Are you sure you want to logout?")) {
        try {
            fetch(`${BASE_URL}/auth/logout`, { method: "POST" }).catch(() => {});
        } catch (e) {}

        localStorage.removeItem("currentUser");
        localStorage.removeItem("token");
        localStorage.removeItem("department");
        localStorage.removeItem("year");

        window.location.href = "index.html";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadAdminInfo();
    loadPendingRequestsCount();
    loadNotificationHistory();
    loadUnreadMessageCount();
});
