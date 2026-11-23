function normalizeIndianMobile(value) {
    const digits = String(value || '').replace(/\D/g, '');
    let nationalNumber = digits;

    if (nationalNumber.length === 13 && nationalNumber.startsWith('091')) {
        nationalNumber = nationalNumber.slice(1);
    }
    if (nationalNumber.length === 12 && nationalNumber.startsWith('91')) {
        nationalNumber = nationalNumber.slice(2);
    } else if (nationalNumber.length === 11 && nationalNumber.startsWith('0')) {
        nationalNumber = nationalNumber.slice(1);
    }

    if (!/^[6-9]\d{9}$/.test(nationalNumber)) return null;
    return `91${nationalNumber}`;
}

function maskPhoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length <= 4) return '*'.repeat(digits.length);
    return `${digits.slice(0, 2)}${'*'.repeat(Math.max(4, digits.length - 6))}${digits.slice(-4)}`;
}

module.exports = { maskPhoneNumber, normalizeIndianMobile };
