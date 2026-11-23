/* ==========================================================================
   staff-student-data.js
   Staff — Student Data page (all 3 years: Year 1, Year 2, Year 3)
   Features: year tabs, search, pagination, edit (persist to MongoDB),
             export Excel / PDF
   ========================================================================== */

'use strict';

/* ── Constants ─────────────────────────────────────────────────────────── */
const SSD_PAGE_SIZE = 20;
const SSD_DEPT      = 'Computer Science';

/* ── State ──────────────────────────────────────────────────────────────── */
let ssdAllStudents  = [];   // all 3 years from backend
let ssdFiltered     = [];   // after year-tab + search filter
let ssdCurrentPage  = 1;
let ssdCurrentYear  = '';   // '' = all years, '1'|'2'|'3' = specific year
let ssdCurrentUser  = null;
let ssdPhotoObjectUrls = new Map();
let ssdPhotoRenderId = 0;
let ssdPhotoStudent = null;
let ssdPhotoSelectedFile = null;
let ssdPhotoPreviewUrl = null;
const SSD_MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/* ── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    ssdCurrentUser = getCurrentUser();   // from script.js

    if (!ssdCurrentUser) {
        alert('Please log in first.');
        window.location.href = 'index.html';
        return;
    }

    // Guard: only Computer Science staff (UG: 1, 2, 3; PG: 1, 2) may use this page
    const isPG = (ssdCurrentUser.program === 'PG') ||
                 (ssdCurrentUser.classId && ssdCurrentUser.classId.startsWith('PG')) ||
                 (ssdCurrentUser.username && ssdCurrentUser.username.toLowerCase().startsWith('pg'));

    const isCSStaff = ssdCurrentUser.role === 'staff' &&
                      String(ssdCurrentUser.department || '').trim().toLowerCase() === 'computer science' &&
                      (isPG ? ['1', '2'].includes(String(ssdCurrentUser.year)) : ['1', '2', '3'].includes(String(ssdCurrentUser.year)));

    if (!isCSStaff) {
        const dest = ssdCurrentUser.role === 'admin' ? 'admin.html' : 'home.html';
        alert('Access denied: This page is only available to Computer Science staff.');
        window.location.href = dest;
        return;
    }

    // ── ROLE-BASED YEAR LOCKING ──────────────────────────────────────────────
    // Staff: hide all tabs; show a single locked label for their year only.
    // Admin would never reach this page (redirected above), but the guard stays.
    const assignedYear = String(ssdCurrentUser.year);
    const tabsContainer = document.getElementById('ssdTabs');

    if (tabsContainer) {
        // Hide every tab button — staff cannot switch years
        tabsContainer.style.display = 'none';
    }

    // Lock the current year filter to the staff's assigned year
    ssdCurrentYear = assignedYear;

    // Update the subtitle immediately so the user sees their class
    const yearLabel = isPG
        ? (assignedYear === '1' ? 'PG 1st Year (PGCS1)' : 'PG 2nd Year (PGCS2)')
        : (assignedYear === '1' ? '1st Year (CS1)' :
           assignedYear === '2' ? '2nd Year (CS2)' :
           assignedYear === '3' ? '3rd Year (CS3)' : `Year ${assignedYear}`);

    const subtitleEl = document.getElementById('ssdSubtitle');
    if (subtitleEl) {
        subtitleEl.textContent = `Computer Science · ${yearLabel}`;
    }
    // ────────────────────────────────────────────────────────────────────────

    ssdLoadStudents();
});

/* ── Load students from backend ─────────────────────────────────────────── */
async function ssdLoadStudents() {
    ssdShowLoading(true);
    ssdMsg('', '');

    const token = localStorage.getItem('token');
    if (!token) {
        ssdMsg('Authentication required. Please log in again.', 'error');
        ssdShowLoading(false);
        return;
    }

    try {
        // Staff send no year param — backend enforces their year server-side.
        // This prevents any attempt to forge a different year via URL manipulation.
        const res  = await fetch(`${BASE_URL}/students/allyears`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || 'Failed to load students');
        }

        // Extra client-side safety: filter to Computer Science and to the
        // assigned year and program. Even if the server were to send extra records,
        // the UI will never display them.
        const assignedYear = String(ssdCurrentUser.year || '');
        const isPG = (ssdCurrentUser.program === 'PG') ||
                     (ssdCurrentUser.classId && ssdCurrentUser.classId.startsWith('PG')) ||
                     (ssdCurrentUser.username && ssdCurrentUser.username.toLowerCase().startsWith('pg'));
        const targetProg = isPG ? 'PG' : 'UG';

        ssdAllStudents = (data.students || []).filter(s => {
            const isCS = s.department && s.department.trim().toLowerCase() === SSD_DEPT.toLowerCase();
            const inYear = s.year === undefined || assignedYear === '' || String(s.year) === assignedYear;
            const inProg = String(s.program || (s.classId && s.classId.startsWith('PG') ? 'PG' : 'UG')).toUpperCase() === targetProg;
            return isCS && inYear && inProg;
        });

        // Sort by year then roll number
        ssdAllStudents = ssdSortByYearAndRoll(ssdAllStudents);

        // Update tab counts (tabs are hidden for staff, but counts keep state correct)
        ssdUpdateTabCounts();

        ssdApplyFilter();
    } catch (err) {
        console.error('ssdLoadStudents:', err);
        ssdMsg(`❌ ${err.message}`, 'error');
        ssdShowLoading(false);
    }
}

/* ── Year tab counts ─────────────────────────────────────────────────────── */
function ssdUpdateTabCounts() {
    ['', '1', '2', '3'].forEach(yr => {
        const badge = document.getElementById(`tabBadge${yr === '' ? 'All' : yr}`);
        if (!badge) return;
        const count = yr === ''
            ? ssdAllStudents.length
            : ssdAllStudents.filter(s => String(s.year) === yr).length;
        badge.textContent = count;
    });
}

/* ── Year tab click ──────────────────────────────────────────────────────── */
function ssdSetYear(year) {
    ssdCurrentYear = year;
    ssdCurrentPage = 1;

    // Update active tab styling
    document.querySelectorAll('.ssd-tab').forEach(t => t.classList.remove('active'));
    const activeId = year === '' ? 'tabAll' : `tab${year}`;
    const activeEl = document.getElementById(activeId);
    if (activeEl) activeEl.classList.add('active');

    // Update subtitle
    const subtitleEl = document.getElementById('ssdSubtitle');
    if (subtitleEl) {
        const yearLabel = year === '' ? 'All Years (1st, 2nd, 3rd)' :
                          year === '1' ? '1st Year' :
                          year === '2' ? '2nd Year' : '3rd Year';
        subtitleEl.textContent = `Computer Science · ${yearLabel}`;
    }

    ssdApplyFilter();
}

/* ── Search + year filter ───────────────────────────────────────────────── */
function ssdApplyFilter() {
    const q = (document.getElementById('ssdSearchInput').value || '').trim().toLowerCase();

    // ssdCurrentYear is locked to the staff's assigned year at init time.
    // It is only empty ('') if the user is admin and clicked "All Years".
    let pool = ssdCurrentYear === ''
        ? ssdAllStudents
        : ssdAllStudents.filter(s => String(s.year) === ssdCurrentYear);

    if (q) {
        pool = pool.filter(s => {
            const name = (s.studentName || s.name || '').toLowerCase();
            const roll = (s.studentId   || s.id   || '').toLowerCase();
            return name.includes(q) || roll.includes(q);
        });
    }

    ssdFiltered    = pool;
    ssdCurrentPage = 1;
    ssdRender();
}

/* ── Render table ───────────────────────────────────────────────────────── */
function ssdRender() {
    ssdClearRenderedPhotoUrls();
    const tbody   = document.getElementById('ssdTbody');
    const table   = document.getElementById('ssdTable');
    const loading = document.getElementById('ssdLoading');
    const stats   = document.getElementById('ssdStats');

    if (!ssdFiltered.length) {
        loading.style.display = 'block';
        loading.textContent   = ssdAllStudents.length
            ? '🔍 No students match your search / filter.'
            : '📂 No students found. Ask Admin to upload students first.';
        table.style.display   = 'none';
        stats.style.display   = 'none';
        document.getElementById('ssdPagination').innerHTML = '';
        return;
    }

    loading.style.display = 'none';
    table.style.display   = 'table';
    stats.style.display   = 'flex';

    document.getElementById('ssdStatTotal').textContent   =
        `Total: ${ssdCurrentYear === '' ? ssdAllStudents.length : ssdAllStudents.filter(s => String(s.year) === ssdCurrentYear).length}`;
    document.getElementById('ssdStatShowing').textContent =
        `Showing: ${ssdFiltered.length}`;

    // Pagination slice
    const totalPages = Math.ceil(ssdFiltered.length / SSD_PAGE_SIZE);
    ssdCurrentPage   = Math.min(ssdCurrentPage, totalPages);
    const start      = (ssdCurrentPage - 1) * SSD_PAGE_SIZE;
    const pageItems  = ssdFiltered.slice(start, start + SSD_PAGE_SIZE);

    tbody.innerHTML = pageItems.map((s, idx) => {
        const rollNo  = s.studentId || s.id || '—';
        const name    = s.studentName || s.name || '—';
        const year    = s.year || '—';
        const yearLabel = year === '1' ? '1st Year' : year === '2' ? '2nd Year' : year === '3' ? '3rd Year' : `Year ${year}`;
        const phone   = s.phone || '—';
        const email   = s.email || '—';
        const dob     = s.dateOfBirth ? ssdFmtDate(s.dateOfBirth) : '—';
        const serial  = start + idx + 1;

        // Year badge colour
        const yearColor = year === '1' ? '#2563eb' : year === '2' ? '#16a34a' : '#7c3aed';
        const studentMongoId = ssdEsc(s._id || '');
        const legacyPhoto = ssdLegacyPhotoSource(s.photo);
        const initials = ssdEsc(ssdInitials(name));

        return `<tr>
            <td style="color:#94a3b8;">${serial}</td>
            <td class="ssd-photo-cell">
                <div class="ssd-photo-frame">
                    <img id="ssdPhotoImage-${studentMongoId}" alt="${ssdEsc(name)}" ${legacyPhoto ? `src="${ssdEsc(legacyPhoto)}"` : 'hidden'} onerror="this.hidden=true; this.nextElementSibling.hidden=false;">
                    <span class="ssd-photo-placeholder" ${legacyPhoto || s.photoId ? 'hidden' : ''}>No Photo</span>
                </div>
                <button class="ssd-photo-btn" type="button" onclick="ssdOpenPhotoEditor('${studentMongoId}')">${s.photoId || legacyPhoto ? 'Edit Photo' : 'Add Photo'}</button>
            </td>
            <td class="ssd-rollno">${ssdEsc(rollNo)}</td>
            <td class="ssd-name">${ssdEsc(name)}</td>
            <td>
                <span style="background:${yearColor};color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap;">
                    CS${ssdEsc(year)} · ${yearLabel}
                </span>
            </td>
            <td style="color:#94a3b8;font-size:12px;">${ssdEsc(phone)}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px;" title="${ssdEsc(email)}">${ssdEsc(email)}</td>
            <td style="color:#94a3b8;font-size:12px;">${ssdEsc(dob)}</td>
            <td style="text-align:center;">
                <button class="ssd-edit-btn" onclick="ssdOpenEdit('${ssdEsc(s._id || '')}')">✏️ Edit</button>
            </td>
        </tr>`;
    }).join('');

    ssdLoadRenderedPhotos(pageItems, ssdPhotoRenderId);
    ssdRenderPagination(totalPages);
}

function ssdClearRenderedPhotoUrls() {
    ssdPhotoRenderId++;
    ssdPhotoObjectUrls.forEach(url => URL.revokeObjectURL(url));
    ssdPhotoObjectUrls.clear();
}

function ssdLegacyPhotoSource(photo) {
    const value = String(photo || '').trim();
    return /^https?:\/\//i.test(value) || /^data:image\/(?:jpeg|png);base64,/i.test(value) ? value : '';
}

function ssdInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

async function ssdFetchPhotoUrl(studentId) {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Authentication required. Please log in again.');

    const response = await fetch(`${BASE_URL}/students/${encodeURIComponent(studentId)}/photo`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Unable to load student photo');
    }

    const blob = await response.blob();
    if (!['image/jpeg', 'image/png'].includes(blob.type)) {
        throw new Error('The student photo has an unsupported image type');
    }
    return URL.createObjectURL(blob);
}

async function ssdLoadRenderedPhotos(pageItems, renderId) {
    const photos = pageItems.filter(student => student.photoId && student._id);
    await Promise.all(photos.map(async student => {
        try {
            const url = await ssdFetchPhotoUrl(student._id);
            if (renderId !== ssdPhotoRenderId) {
                URL.revokeObjectURL(url);
                return;
            }
            const image = document.getElementById(`ssdPhotoImage-${student._id}`);
            if (!image) {
                URL.revokeObjectURL(url);
                return;
            }
            ssdPhotoObjectUrls.set(student._id, url);
            image.src = url;
            image.hidden = false;
            image.nextElementSibling.hidden = true;
        } catch (error) {
            console.warn(`Could not load photo for student ${student.studentId}:`, error.message);
        }
    }));
}

/* ── Pagination ─────────────────────────────────────────────────────────── */
function ssdRenderPagination(totalPages) {
    const el = document.getElementById('ssdPagination');
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    let html = `<button class="ssd-page-btn" onclick="ssdGoPage(${ssdCurrentPage - 1})" ${ssdCurrentPage === 1 ? 'disabled' : ''}>‹ Prev</button>`;

    for (let p = 1; p <= totalPages; p++) {
        if (totalPages > 7 && Math.abs(p - ssdCurrentPage) > 2 && p !== 1 && p !== totalPages) {
            if (p === 2 || p === totalPages - 1) html += `<span class="ssd-page-info">…</span>`;
            continue;
        }
        html += `<button class="ssd-page-btn ${p === ssdCurrentPage ? 'active' : ''}" onclick="ssdGoPage(${p})">${p}</button>`;
    }

    html += `<button class="ssd-page-btn" onclick="ssdGoPage(${ssdCurrentPage + 1})" ${ssdCurrentPage === totalPages ? 'disabled' : ''}>Next ›</button>`;
    html += `<span class="ssd-page-info">Page ${ssdCurrentPage} of ${totalPages}</span>`;
    el.innerHTML = html;
}

function ssdGoPage(p) {
    const totalPages = Math.ceil(ssdFiltered.length / SSD_PAGE_SIZE);
    ssdCurrentPage = Math.max(1, Math.min(p, totalPages));
    ssdRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Edit modal — open ──────────────────────────────────────────────────── */
function ssdOpenAdd() {
    for (const id of ['editMongoId','editRollNo','editName','editPhone','editEmail','editDob','editParentName','editParentPhone','editAddress','editUmisId','editAbcId']) {
        const el = document.getElementById(id); if (el) el.value = '';
    }
    document.getElementById('editGender').value = '';
    document.getElementById('editDayScholarHosteller').value = '';
    document.getElementById('editRollDisplay').textContent = 'Enter roll number after opening';
    document.getElementById('editDeptDisplay').textContent = ssdCurrentUser.department || '—';
    document.getElementById('editYearDisplay').textContent = `${ssdCurrentUser.classId || ''} · Year ${ssdCurrentYear}`;
    document.getElementById('ssdSaveBtn').textContent = 'Add Student';
    document.getElementById('ssdEditOverlay').classList.add('open');
}

function ssdOpenEdit(mongoId) {
    if (!mongoId) {
        ssdMsg('Cannot edit: student record is missing database ID. Please refresh.', 'error');
        return;
    }

    const student = ssdAllStudents.find(s => s._id === mongoId);
    if (!student) {
        ssdMsg('Student not found in loaded data. Please refresh.', 'error');
        return;
    }

    const year = student.year || '—';
    const yearLabel = year === '1' ? '1st Year' : year === '2' ? '2nd Year' : year === '3' ? '3rd Year' : `Year ${year}`;

    document.getElementById('editRollDisplay').textContent  = student.studentId || student.id || '—';
    document.getElementById('editDeptDisplay').textContent  = student.department || '—';
    document.getElementById('editYearDisplay').textContent  = `${yearLabel} (CS${year})`;

    document.getElementById('editMongoId').value = mongoId;
    document.getElementById('editRollNo').value  = student.studentId || student.id || '';

    document.getElementById('editName').value        = student.studentName || student.name || '';
    document.getElementById('editPhone').value       = student.phone       || '';
    document.getElementById('editEmail').value       = student.email       || '';
    document.getElementById('editDob').value         = student.dateOfBirth ? String(student.dateOfBirth).split('T')[0] : '';
    document.getElementById('editGender').value      = student.gender      || '';
    document.getElementById('editParentName').value  = student.parentName  || '';
    document.getElementById('editParentPhone').value = student.parentPhone || '';
    document.getElementById('editAddress').value     = student.address     || '';
    document.getElementById('editUmisId').value = student.umisId || '';
    document.getElementById('editAbcId').value = student.abcId || '';
    document.getElementById('editDayScholarHosteller').value = student.dayScholarHosteller || '';

    const saveBtn = document.getElementById('ssdSaveBtn');
    saveBtn.disabled    = false;
    saveBtn.textContent = '💾 Save Changes';

    document.getElementById('ssdEditOverlay').classList.add('open');
}

/* ── Edit modal — close ─────────────────────────────────────────────────── */
function ssdCloseEdit() {
    document.getElementById('ssdEditOverlay').classList.remove('open');
}

function ssdOpenPhotoEditor(mongoId) {
    const photoProgram = ssdCurrentUser && (ssdCurrentUser.program === 'PG' || (ssdCurrentUser.classId || '').startsWith('PG')) ? 'PG' : 'UG';
    const isCSStaff = ssdCurrentUser && ssdCurrentUser.role === 'staff' &&
        String(ssdCurrentUser.department || '').trim().toLowerCase() === 'computer science' &&
        (photoProgram === 'PG' ? ['1', '2'].includes(String(ssdCurrentUser.year)) : ['1', '2', '3'].includes(String(ssdCurrentUser.year)));
    if (!isCSStaff) {
        ssdMsg('Access denied: photo editing is only available to CS1, CS2, and CS3 staff.', 'error');
        return;
    }

    const student = ssdAllStudents.find(s => s._id === mongoId);
    if (!student) {
        ssdMsg('Student not found in loaded data. Please refresh.', 'error');
        return;
    }

    ssdRevokePhotoPreviewUrl();
    ssdPhotoStudent = student;
    ssdPhotoSelectedFile = null;
    document.getElementById('ssdPhotoInput').value = '';
    document.getElementById('ssdPhotoStudentLabel').textContent =
        `${student.studentName || student.name || 'Student'} · ${student.studentId || student.id || ''}`;
    document.getElementById('ssdPhotoRemoveBtn').style.display =
        student.photoId || ssdLegacyPhotoSource(student.photo) ? '' : 'none';
    ssdSetPhotoPreview('', 'No photo selected');
    document.getElementById('ssdPhotoOverlay').classList.add('open');

    const existingUrl = ssdPhotoObjectUrls.get(student._id) || ssdLegacyPhotoSource(student.photo);
    if (existingUrl) {
        ssdSetPhotoPreview(existingUrl, 'Current photo');
        return;
    }

    if (student.photoId) {
        ssdSetPhotoPreview('', 'Loading current photo…');
        ssdFetchPhotoUrl(student._id).then(url => {
            if (!document.getElementById('ssdPhotoOverlay').classList.contains('open') ||
                !ssdPhotoStudent || ssdPhotoStudent._id !== student._id || ssdPhotoSelectedFile) {
                URL.revokeObjectURL(url);
                return;
            }
            ssdPhotoPreviewUrl = url;
            ssdSetPhotoPreview(url, 'Current photo');
        }).catch(error => {
            if (ssdPhotoStudent && ssdPhotoStudent._id === student._id && !ssdPhotoSelectedFile) {
                ssdSetPhotoPreview('', error.message);
            }
        });
    }
}

function ssdSetPhotoPreview(src, status) {
    const image = document.getElementById('ssdPhotoPreview');
    const placeholder = document.getElementById('ssdPhotoPreviewPlaceholder');
    if (src) image.src = src;
    else image.removeAttribute('src');
    image.style.display = src ? 'block' : 'none';
    placeholder.style.display = src ? 'none' : 'inline';
    placeholder.textContent = src ? '' : (status || 'No photo selected');
    document.getElementById('ssdPhotoStatus').textContent = status || '';
}

function ssdPreviewPhoto(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();
    const validType = (file.type === 'image/jpeg' && ['jpg', 'jpeg'].includes(extension)) ||
        (file.type === 'image/png' && extension === 'png');
    if (!validType) {
        event.target.value = '';
        ssdPhotoSelectedFile = null;
        ssdRevokePhotoPreviewUrl();
        document.getElementById('ssdPhotoStatus').textContent = 'Choose a JPG, JPEG, or PNG image.';
        ssdSetPhotoPreview('', 'Choose a JPG, JPEG, or PNG image.');
        return;
    }
    if (file.size > SSD_MAX_PHOTO_BYTES) {
        event.target.value = '';
        ssdPhotoSelectedFile = null;
        ssdRevokePhotoPreviewUrl();
        document.getElementById('ssdPhotoStatus').textContent = 'Photo must be 5 MB or smaller.';
        ssdSetPhotoPreview('', 'Photo must be 5 MB or smaller.');
        return;
    }

    ssdRevokePhotoPreviewUrl();
    ssdPhotoSelectedFile = file;
    ssdPhotoPreviewUrl = URL.createObjectURL(file);
    ssdSetPhotoPreview(ssdPhotoPreviewUrl, `Preview: ${file.name}`);
}

function ssdRevokePhotoPreviewUrl() {
    if (ssdPhotoPreviewUrl) URL.revokeObjectURL(ssdPhotoPreviewUrl);
    ssdPhotoPreviewUrl = null;
}

function ssdClosePhotoEditor() {
    document.getElementById('ssdPhotoOverlay').classList.remove('open');
    document.getElementById('ssdPhotoInput').value = '';
    ssdRevokePhotoPreviewUrl();
    ssdPhotoStudent = null;
    ssdPhotoSelectedFile = null;
}

async function ssdSavePhoto() {
    if (!ssdPhotoStudent || !ssdPhotoSelectedFile) {
        document.getElementById('ssdPhotoStatus').textContent = 'Choose a photo before saving.';
        return;
    }

    const student = ssdPhotoStudent;
    const selectedFile = ssdPhotoSelectedFile;
    const token = localStorage.getItem('token');
    if (!token) {
        document.getElementById('ssdPhotoStatus').textContent = 'Session expired. Please log in again.';
        return;
    }

    const saveButton = document.getElementById('ssdPhotoSaveBtn');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    const formData = new FormData();
    formData.append('photo', selectedFile, selectedFile.name);

    try {
        const response = await fetch(`${BASE_URL}/students/${encodeURIComponent(student._id)}/photo`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.message || 'Photo upload failed');

        student.photoId = data.photoId;
        student.photoMimeType = data.photoMimeType;
        student.photo = '';
        if (ssdPhotoStudent === student) ssdClosePhotoEditor();
        ssdRender();
        ssdMsg(`✅ ${data.message}`, 'success');
    } catch (error) {
        console.error('ssdSavePhoto:', error);
        document.getElementById('ssdPhotoStatus').textContent = error.message;
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Photo';
    }
}

async function ssdRemovePhoto() {
    if (!ssdPhotoStudent) return;
    if (!confirm('Remove this student photo?')) return;

    const student = ssdPhotoStudent;
    const token = localStorage.getItem('token');
    if (!token) {
        document.getElementById('ssdPhotoStatus').textContent = 'Session expired. Please log in again.';
        return;
    }

    const removeButton = document.getElementById('ssdPhotoRemoveBtn');
    removeButton.disabled = true;
    try {
        const response = await fetch(`${BASE_URL}/students/${encodeURIComponent(student._id)}/photo`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.message || 'Photo removal failed');

        student.photoId = null;
        student.photoMimeType = '';
        student.photo = '';
        if (ssdPhotoStudent === student) ssdClosePhotoEditor();
        ssdRender();
        ssdMsg(`✅ ${data.message}`, 'success');
    } catch (error) {
        console.error('ssdRemovePhoto:', error);
        document.getElementById('ssdPhotoStatus').textContent = error.message;
    } finally {
        removeButton.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('ssdEditOverlay');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) ssdCloseEdit(); });
    const photoOverlay = document.getElementById('ssdPhotoOverlay');
    if (photoOverlay) photoOverlay.addEventListener('click', e => { if (e.target === photoOverlay) ssdClosePhotoEditor(); });
});

/* ── Edit modal — save ──────────────────────────────────────────────────── */
async function ssdSaveEdit() {
    const mongoId = document.getElementById('editMongoId').value.trim();
    const name    = document.getElementById('editName').value.trim();

    if (!name) {
        ssdMsg('Student Name is required.', 'error');
        return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
        ssdMsg('Session expired. Please log in again.', 'error');
        return;
    }

    // Only send staff-editable fields — roll number, dept, year are locked
    const payload = {
        studentName : name,
        phone       : document.getElementById('editPhone').value.trim(),
        email       : document.getElementById('editEmail').value.trim(),
        dateOfBirth : document.getElementById('editDob').value.trim() || undefined,
        gender      : document.getElementById('editGender').value.trim(),
        parentName  : document.getElementById('editParentName').value.trim(),
        parentPhone : document.getElementById('editParentPhone').value.trim(),
        address     : document.getElementById('editAddress').value.trim(),
        umisId      : document.getElementById('editUmisId').value.trim(),
        abcId       : document.getElementById('editAbcId').value.trim(),
        dayScholarHosteller: document.getElementById('editDayScholarHosteller').value
    };
    if (!mongoId) {
        const roll = (prompt('Enter the student Roll Number:') || '').trim().toUpperCase();
        if (!roll) { ssdMsg('Roll Number is required.', 'error'); return; }
        payload.studentId = roll;
        payload.department = ssdCurrentUser.department;
        payload.year = String(ssdCurrentUser.year);
        payload.program = ssdCurrentUser.program || ((ssdCurrentUser.classId || '').startsWith('PG') ? 'PG' : 'UG');
        payload.classId = ssdCurrentUser.classId || `${payload.program === 'PG' ? 'PGCS' : 'CS'}${payload.year}`;
    }
    // Strip empty/undefined — don't overwrite existing DB values with blank strings
    Object.keys(payload).forEach(k => {
        if (payload[k] === undefined || payload[k] === null || payload[k] === '') delete payload[k];
    });

    const saveBtn = document.getElementById('ssdSaveBtn');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';

    try {
        const res  = await fetch(mongoId ? `${BASE_URL}/students/${mongoId}` : `${BASE_URL}/students/register`, {
            method  : mongoId ? 'PUT' : 'POST',
            headers : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body    : JSON.stringify(payload)
        });
        const data = await res.json();

        saveBtn.disabled    = false;
        saveBtn.textContent = '💾 Save Changes';

        if (!res.ok || !data.success) throw new Error(data.message || 'Save failed');

        // Update local cache with server response
        const updated = data.student || {};
        const idx = ssdAllStudents.findIndex(s => s._id === mongoId);
        if (idx !== -1) ssdAllStudents[idx] = { ...ssdAllStudents[idx], ...updated };
        else if (updated._id) ssdAllStudents.push(updated);

        // Sync localStorage student cache (used by attendance page)
        try {
            const cached = JSON.parse(localStorage.getItem('students') || '[]');
            const ci = cached.findIndex(s => s._id === mongoId ||
                (s.studentId || s.id) === (updated.studentId || updated.id));
            if (ci !== -1) cached[ci] = { ...cached[ci], ...updated };
            localStorage.setItem('students', JSON.stringify(cached));
        } catch (_) {}

        ssdUpdateTabCounts();
        ssdCloseEdit();
        ssdApplyFilter();
        ssdMsg(`✅ "${name}" updated successfully. Changes are now visible to Admin.`, 'success');

    } catch (err) {
        saveBtn.disabled    = false;
        saveBtn.textContent = '💾 Save Changes';
        console.error('ssdSaveEdit:', err);
        ssdMsg(`❌ ${err.message}`, 'error');
    }
}

/* ── Export — Excel ─────────────────────────────────────────────────────── */
function ssdExportExcel() {
    if (!ssdFiltered.length) { alert('No data to export.'); return; }

    const yearLabel = ssdCurrentYear === '' ? 'All_Years'
                    : ssdCurrentYear === '1' ? 'Year1'
                    : ssdCurrentYear === '2' ? 'Year2' : 'Year3';

    const rows = ssdFiltered.map((s, i) => ({
        'S.No'         : i + 1,
        'Roll Number'  : s.studentId || s.id || '',
        'Student Name' : s.studentName || s.name || '',
        'Department'   : s.department || '',
        'Year'         : `Year ${s.year}`,
        'Class'        : `CS${s.year}`,
        'Gender'       : s.gender || '',
        'Date of Birth': s.dateOfBirth ? ssdFmtDate(s.dateOfBirth) : '',
        'Phone'        : s.phone || '',
        'Email'        : s.email || '',
        'Parent Name'  : s.parentName || '',
        'Parent Phone' : s.parentPhone || '',
        'Address'      : s.address || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `CS_${yearLabel}`);

    // Auto-fit column widths
    ws['!cols'] = Object.keys(rows[0]).map(k => ({
        wch: Math.max(k.length, ...rows.map(r => String(r[k] || '').length)) + 2
    }));

    XLSX.writeFile(wb, `CS_Students_${yearLabel}_${ssdTodayStr()}.xlsx`);
}

/* ── Export — PDF ───────────────────────────────────────────────────────── */
async function ssdExportPDF() {
    if (!ssdFiltered.length) { alert('No data to export.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const pageWidth = doc.internal.pageSize.width, center = doc.internal.pageSize.width / 2;
    const yearLabel = ssdCurrentYear === '' ? 'All Years' : ssdCurrentYear === '1' ? '1st Year' : ssdCurrentYear === '2' ? '2nd Year' : '3rd Year';
    const program = ssdCurrentUser.program || (ssdCurrentUser.classId && ssdCurrentUser.classId.startsWith('PG') ? 'PG' : 'UG');
    const className = ssdCurrentUser.classId || `${program === 'PG' ? 'PGCS' : 'CS'}${ssdCurrentYear || ssdCurrentUser.year || ''}`;
    doc.setTextColor(20,45,85); doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.text('THANTHAI HANS ROEVER COLLEGE (AUTONOMOUS)',center,14,{align:'center'});
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.text('(Affiliated to Bharathidasan University)',center,20,{align:'center'});
    doc.text("Accredited with 'A' Grade by NAAC (3rd cycle) with CGPA 3.23 out of 4",center,25,{align:'center'}); doc.text('ELAMBALUR (P.O), PERAMBALUR - 621 220',center,30,{align:'center'});
    doc.setDrawColor(20,45,85); doc.line(10,33,pageWidth-10,33); doc.setFillColor(28,78,145); doc.rect(10,35,pageWidth-20,9,'F');
    doc.setTextColor(255); doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.text('STUDENT DATA',center,41,{align:'center'});
    doc.setTextColor(0); doc.setFillColor(221,239,250); doc.rect(10,45,pageWidth-20,16,'F'); doc.setFontSize(8); doc.setFont(undefined,'normal');
    doc.text(`Programme: ${program}   Department: ${ssdAllStudents[0]?.department || ssdCurrentUser.department || '—'}   Academic Year: ${yearLabel}   Class: ${className}`,13,51);
    doc.text(`Total Students: ${ssdFiltered.length}   Generated: ${new Date().toLocaleString('en-IN')}`,13,57);
    const headers=['S.No','Roll No','Student Name','Academic Year','Gender','DOB','Student Mobile No.','Parent / Guardian Name','Parent / Guardian Mobile No.','UMIS ID','ABC ID','Day Scholar / Hosteller','Address','Photo'];
    const body=ssdFiltered.map((s,i)=>[String(i+1),s.studentId||s.id||'—',s.studentName||s.name||'—',s.academicYear||`Year ${s.year||'—'}`,s.gender||'—',s.dateOfBirth?ssdFmtDate(s.dateOfBirth):'—',s.phone||'—',s.parentName||'—',s.parentPhone||'—',s.umisId||'—',s.abcId||'—',s.dayScholarHosteller||'—',s.address||'—',s.photoId||s.photo?'':'No Photo']);
    const photos=new Map();
    await Promise.all(ssdFiltered.map(async s=>{if(!s.photoId&&!ssdLegacyPhotoSource(s.photo))return;try{const url=ssdPhotoObjectUrls.get(s._id)||ssdLegacyPhotoSource(s.photo)||await ssdFetchPhotoUrl(s._id);const blob=await(await fetch(url)).blob();const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});if(data)photos.set(s._id,{data,type:blob.type==='image/png'?'PNG':'JPEG'});}catch(_){}}));
    doc.autoTable({head:[headers],body,startY:64,theme:'grid',rowPageBreak:'avoid',styles:{fontSize:6.5,cellPadding:1.5,overflow:'linebreak',valign:'middle',lineColor:[0,0,0],lineWidth:0.15},headStyles:{fillColor:[205,229,245],textColor:[0,0,0],fontStyle:'bold',halign:'center'},margin:{top:18,left:10,right:10,bottom:12},columnStyles:{0:{cellWidth:9},1:{cellWidth:22},2:{cellWidth:35},3:{cellWidth:18},4:{cellWidth:13},5:{cellWidth:18},6:{cellWidth:24},7:{cellWidth:30},8:{cellWidth:27},9:{cellWidth:17},10:{cellWidth:17},11:{cellWidth:25},12:{cellWidth:45},13:{cellWidth:25,minCellHeight:23,halign:'center'}},didDrawCell:data=>{if(data.section!=='body'||data.column.index!==13)return;const s=ssdFiltered[data.row.index],p=photos.get(s&&s._id);if(p)try{doc.addImage(p.data,p.type,data.cell.x+2,data.cell.y+2,18,19,undefined,'FAST');}catch(_){}}});
    const pages=doc.internal.getNumberOfPages(); for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setFont(undefined,'normal');doc.text(`Page ${i} of ${pages}`,center,doc.internal.pageSize.height-5,{align:'center'});}
    const fileYear=ssdCurrentYear===''?'AllYears':`Year${ssdCurrentYear}`; doc.save(`${program}_${className}_Students_${fileYear}_${ssdTodayStr()}.pdf`);
}

function ssdExportPDFLegacy() {
    if (!ssdFiltered.length) { alert('No data to export.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const yearLabel = ssdCurrentYear === '' ? 'All Years (1st, 2nd & 3rd)'
                    : ssdCurrentYear === '1' ? '1st Year'
                    : ssdCurrentYear === '2' ? '2nd Year' : '3rd Year';

    // ── College header ──
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text('THANTHAI HANS ROEVER COLLEGE (AUTONOMOUS)', 148, 14, { align: 'center' });
    doc.setFontSize(9);  doc.setFont(undefined, 'normal');
    doc.text('(Affiliated to Bharathidasan University)', 148, 20, { align: 'center' });
    doc.text("Accredited with 'A' Grade by NAAC (3rd cycle) with CGPA 3.23 out of 4", 148, 25, { align: 'center' });
    doc.text('ELAMBALUR (P.O), PERAMBALUR – 621 220', 148, 30, { align: 'center' });
    doc.setDrawColor(80, 80, 80);
    doc.line(10, 33, 287, 33);

    doc.setFontSize(12); doc.setFont(undefined, 'bold');
    doc.text(`Computer Science – ${yearLabel} : Student Data`, 148, 40, { align: 'center' });
    doc.setFontSize(9);  doc.setFont(undefined, 'normal');
    doc.text(
        `Total: ${ssdAllStudents.length}  |  Showing: ${ssdFiltered.length}  |  Generated: ${new Date().toLocaleString('en-IN')}`,
        148, 46, { align: 'center' }
    );

    // ── Table ──
    const head = [['S.No', 'Roll No', 'Student Name', 'Year', 'Gender', 'DOB', 'Phone', 'Email', 'Parent Name', 'Address']];
    const body = ssdFiltered.map((s, i) => [
        i + 1,
        s.studentId || s.id || '',
        s.studentName || s.name || '',
        `Year ${s.year}`,
        s.gender || '—',
        s.dateOfBirth ? ssdFmtDate(s.dateOfBirth) : '—',
        s.phone || '—',
        s.email || '—',
        s.parentName || '—',
        (s.address || '').substring(0, 35)
    ]);

    doc.autoTable({
        head, body,
        startY            : 50,
        styles            : { fontSize: 8, cellPadding: 2.5 },
        headStyles        : { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        margin            : { top: 50, left: 10, right: 10 },
        columnStyles      : {
            0: { cellWidth: 10 },
            1: { cellWidth: 24 },
            2: { cellWidth: 40 },
            3: { cellWidth: 16 },
            4: { cellWidth: 14 },
            5: { cellWidth: 20 },
            6: { cellWidth: 24 },
            7: { cellWidth: 36 },
            8: { cellWidth: 28 },
            9: { cellWidth: 'auto' }
        }
    });

    // ── Page numbers ──
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setFont(undefined, 'normal');
        doc.text(`Page ${i} of ${pageCount}`, 148, doc.internal.pageSize.height - 5, { align: 'center' });
    }

    const fileYear = ssdCurrentYear === '' ? 'AllYears'
                   : ssdCurrentYear === '1' ? 'Year1'
                   : ssdCurrentYear === '2' ? 'Year2' : 'Year3';
    doc.save(`CS_Students_${fileYear}_${ssdTodayStr()}.pdf`);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function ssdSortByYearAndRoll(arr) {
    return [...arr].sort((a, b) => {
        // Sort by year first
        const ya = Number(a.year || 9), yb = Number(b.year || 9);
        if (ya !== yb) return ya - yb;
        // Then by roll number (natural numeric)
        const ra = String(a.studentId || a.id || '').trim().toUpperCase();
        const rb = String(b.studentId || b.id || '').trim().toUpperCase();
        const ca = ra.match(/(\d+|[^\d]+)/g) || [ra];
        const cb = rb.match(/(\d+|[^\d]+)/g) || [rb];
        for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
            const x = ca[i] || '', y = cb[i] || '';
            if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
                const d = parseInt(x, 10) - parseInt(y, 10);
                if (d !== 0) return d;
            } else {
                if (x < y) return -1;
                if (x > y) return  1;
            }
        }
        return 0;
    });
}

function ssdFmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (_) { return String(d).split('T')[0]; }
}

function ssdTodayStr() { return new Date().toISOString().split('T')[0]; }

function ssdEsc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ssdShowLoading(show) {
    document.getElementById('ssdLoading').style.display = show ? 'block' : 'none';
    document.getElementById('ssdTable').style.display   = show ? 'none'  : '';
    document.getElementById('ssdStats').style.display   = show ? 'none'  : '';
}

function ssdMsg(text, type) {
    const el = document.getElementById('ssdMessage');
    if (!text) { el.style.display = 'none'; return; }
    el.className    = type;
    el.textContent  = text;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}
