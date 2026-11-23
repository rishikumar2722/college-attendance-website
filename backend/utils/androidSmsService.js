/**
 * androidSmsService.js
 *
 * Android SMS Gateway client.
 * Official project: https://github.com/capcom6/android-sms-gateway
 *
 * REST API reference (Local Server mode):
 *   POST /api/v1/message
 *   Body: { "message": "...", "phoneNumbers": ["79990001234"], "simNumber": 1 }
 *   Auth: HTTP Basic (username:password)
 *   Response: { "id": "...", "state": "Pending"|"Processed"|"Sent"|"Delivered"|"Failed", ... }
 *
 * GET /api/v1/message/:id — poll delivery state
 * GET /api/v1/health     — gateway health check (no auth required by gateway)
 *
 * All credentials come from environment variables — never from frontend JS.
 */

'use strict';

const { normalizeIndianMobile } = require('./smsPhoneUtils');

const MAX_FAILURE_LENGTH = 400;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getConfig() {
    const url      = String(process.env.ANDROID_SMS_GATEWAY_URL      || '').trim().replace(/\/$/, '');
    const username = String(process.env.ANDROID_SMS_GATEWAY_USERNAME  || '').trim();
    const password = String(process.env.ANDROID_SMS_GATEWAY_PASSWORD  || '').trim();
    const timeout  = parseInt(process.env.ANDROID_SMS_GATEWAY_TIMEOUT || '15000', 10);
    const simSlot  = process.env.ANDROID_SMS_GATEWAY_SIM
        ? parseInt(process.env.ANDROID_SMS_GATEWAY_SIM, 10)
        : null;

    return { url, username, password, timeout, simSlot };
}

function basicAuthHeader(username, password) {
    const credentials = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return `Basic ${credentials}`;
}

function truncate(str, len) {
    return String(str || '').slice(0, len);
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Returns a human-readable error string if the gateway is not configured,
 * or an empty string if configuration looks valid.
 */
function getConfigError() {
    const { url, username, password } = getConfig();
    if (!url)      return 'ANDROID_SMS_GATEWAY_URL is not configured';
    if (!username) return 'ANDROID_SMS_GATEWAY_USERNAME is not configured';
    if (!password) return 'ANDROID_SMS_GATEWAY_PASSWORD is not configured';
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return 'ANDROID_SMS_GATEWAY_URL must start with http:// or https://';
        }
    } catch {
        return 'ANDROID_SMS_GATEWAY_URL is not a valid URL';
    }
    return '';
}

// ─── Core fetch wrapper ──────────────────────────────────────────────────────

/**
 * Makes an authenticated request to the Android SMS Gateway.
 * @param {string} method  HTTP method
 * @param {string} path    API path (e.g. '/api/v1/message')
 * @param {object|null} body JSON body for POST requests
 * @returns {{ ok: boolean, status: number, payload: object }}
 */
async function gatewayFetch(method, path, body = null) {
    const { url, username, password, timeout } = getConfig();

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    const headers = {
        'Authorization': basicAuthHeader(username, password),
        'Content-Type':  'application/json',
        'Accept':        'application/json'
    };

    const fetchOptions = {
        method,
        headers,
        signal: controller.signal
    };
    if (body !== null) {
        fetchOptions.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${url}${path}`, fetchOptions);

        let payload = {};
        const text = await response.text();
        if (text) {
            try { payload = JSON.parse(text); }
            catch { payload = { _raw: text }; }
        }

        return { ok: response.ok, status: response.status, payload };
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Android SMS Gateway request timed out after ${timeout}ms`);
        }
        // Network-level failure (phone offline, wrong IP, etc.)
        throw new Error(`Android SMS Gateway unreachable: ${truncate(err.message, 150)}`);
    } finally {
        clearTimeout(timer);
    }
}

// ─── Health check ────────────────────────────────────────────────────────────

/**
 * Checks whether the Android SMS Gateway is reachable.
 * Returns { online: bool, detail: string }
 */
async function checkGatewayHealth() {
    const configError = getConfigError();
    if (configError) {
        return { online: false, detail: configError };
    }

    try {
        const { ok, status, payload } = await gatewayFetch('GET', '/api/v1/health');
        if (ok) {
            const statusValue = payload.status || 'unknown';
            return { online: true, detail: `Gateway responded OK (status: ${statusValue})` };
        }
        return {
            online: false,
            detail: truncate(`Gateway returned HTTP ${status}: ${JSON.stringify(payload)}`, 200)
        };
    } catch (err) {
        return { online: false, detail: truncate(err.message, 200) };
    }
}

// ─── Send SMS ────────────────────────────────────────────────────────────────

/**
 * Sends a single SMS through the Android SMS Gateway.
 *
 * @param {string} phoneNumber  Raw phone number (will be normalised to E.164 without '+')
 * @param {string} message      SMS text
 * @returns {{ providerMessageId: string }}  On success
 * @throws {Error}  On any failure (misconfiguration, network, gateway rejection)
 */
async function sendAndroidSms(phoneNumber, message) {
    // 1. Config check
    const configError = getConfigError();
    if (configError) throw new Error(configError);

    // 2. Phone normalisation — gateway expects E.164 format with country code
    const normalised = normalizeIndianMobile(phoneNumber);
    if (!normalised) throw new Error('Parent mobile number is invalid');

    // 3. Build request body per official API schema
    //    phoneNumbers accepts an array of E.164 numbers (gateway expects digits only, no '+')
    const body = {
        message:      String(message || '').trim(),
        phoneNumbers: [normalised]            // e.g. "919876543210"
    };

    // 4. Optional SIM slot selection
    const { simSlot } = getConfig();
    if (simSlot !== null && !Number.isNaN(simSlot) && simSlot >= 1) {
        body.simNumber = simSlot;
    }

    // 5. POST to gateway
    let response;
    try {
        response = await gatewayFetch('POST', '/api/v1/message', body);
    } catch (err) {
        throw new Error(truncate(err.message, MAX_FAILURE_LENGTH));
    }

    // 6. Parse result
    if (!response.ok) {
        const detail = response.payload.message
            || response.payload.error
            || JSON.stringify(response.payload);
        throw new Error(
            truncate(`Gateway rejected the message (HTTP ${response.status}): ${detail}`, MAX_FAILURE_LENGTH)
        );
    }

    // 7. Extract the message ID returned by the gateway
    const messageId = String(response.payload.id || '');

    // 8. Check the state field — gateway may immediately report failure
    const state = String(response.payload.state || '').toLowerCase();
    if (state === 'failed') {
        const reason = truncate(
            response.payload.reason || response.payload.message || 'Gateway reported message as Failed',
            MAX_FAILURE_LENGTH
        );
        throw new Error(reason);
    }

    return { providerMessageId: messageId };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    sendAndroidSms,
    checkGatewayHealth,
    getConfigError
};
