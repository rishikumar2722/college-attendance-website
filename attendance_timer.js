// attendance_timer.js - simple timer to close attendance at a given time
// Usage: node attendance_timer.js <ISO-8601 datetime>
// Example: node attendance_timer.js 2026-11-20T17:00:00+05:30

if (process.argv.length < 3) {
  console.error('Usage: node attendance_timer.js <ISO datetime>');
  process.exit(1);
}

const target = new Date(process.argv[2]);
if (isNaN(target)) {
  console.error('Invalid datetime format');
  process.exit(1);
}

const now = new Date();
const msUntil = target - now;
if (msUntil <= 0) {
  console.log('Target time already passed. Closing attendance now.');
  // Placeholder: implement actual close logic here (e.g., call API or update DB).
  process.exit(0);
}

console.log(`Attendance will close at ${target.toISOString()} (in ${Math.round(msUntil/1000)} seconds)`);

setTimeout(() => {
  console.log('⏰ Attendance window closed automatically');
  // TODO: Insert real closing actions, such as an HTTP request to the backend:
  // const https = require('https');
  // ...
}, msUntil);
