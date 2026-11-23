/**
 * migrate-period-indexes.js
 *
 * Safe migration script for the 5-period attendance feature.
 *
 * What it does:
 *  1. Drops the OLD unique index on {studentId,date,department,year,program}
 *     (which would block period-based records from being inserted alongside legacy ones).
 *  2. Creates TWO new partial unique indexes:
 *     A) unique_attendance_legacy  — covers records where period IS NULL
 *     B) unique_attendance_period  — covers records where period IN [1,2,3,4,5]
 *
 * What it does NOT do:
 *  - Delete, update, or modify any existing attendance records.
 *  - Affect any other collection.
 *
 * Run once: node scripts/migrate-period-indexes.js
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
}

async function run() {
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
        console.log('Connected to MongoDB Atlas');

        const db = mongoose.connection.db;
        const col = db.collection('attendances');

        // ── 1. List existing indexes ────────────────────────────────────────
        const existingIndexes = await col.indexes();
        console.log('\nExisting indexes:');
        existingIndexes.forEach(idx => {
            console.log(' -', idx.name, JSON.stringify(idx.key));
        });

        // ── 2. Drop the old plain unique index (if it still exists) ─────────
        const oldIndexName = 'studentId_1_date_1_department_1_year_1_program_1';
        const oldIndexExists = existingIndexes.some(idx => idx.name === oldIndexName);

        if (oldIndexExists) {
            await col.dropIndex(oldIndexName);
            console.log(`\nDropped old index: ${oldIndexName}`);
        } else {
            console.log(`\nOld index "${oldIndexName}" not found — already migrated or never existed. Skipping drop.`);
        }

        // ── 3. Create new partial unique indexes ────────────────────────────
        const afterDrop = await col.indexes();

        const legacyIndexName  = 'unique_attendance_legacy';
        const periodIndexName  = 'unique_attendance_period';

        if (!afterDrop.some(idx => idx.name === legacyIndexName)) {
            await col.createIndex(
                { studentId: 1, date: 1, department: 1, year: 1, program: 1 },
                {
                    unique: true,
                    partialFilterExpression: { period: { $type: 'null' } },
                    name: legacyIndexName,
                    background: true
                }
            );
            console.log(`Created index: ${legacyIndexName}`);
        } else {
            console.log(`Index ${legacyIndexName} already exists — skipping.`);
        }

        if (!afterDrop.some(idx => idx.name === periodIndexName)) {
            await col.createIndex(
                { studentId: 1, date: 1, department: 1, year: 1, program: 1, period: 1 },
                {
                    unique: true,
                    partialFilterExpression: { period: { $in: [1, 2, 3, 4, 5] } },
                    name: periodIndexName,
                    background: true
                }
            );
            console.log(`Created index: ${periodIndexName}`);
        } else {
            console.log(`Index ${periodIndexName} already exists — skipping.`);
        }

        // ── 4. Create helper indexes (non-unique, idempotent) ───────────────
        await col.createIndex({ classId: 1, date: 1, period: 1 }, { background: true });
        console.log('Ensured index: {classId, date, period}');

        // ── 5. Final index list ─────────────────────────────────────────────
        const finalIndexes = await col.indexes();
        console.log('\nFinal indexes:');
        finalIndexes.forEach(idx => console.log(' -', idx.name, JSON.stringify(idx.key)));

        console.log('\n✅ Migration completed successfully. No attendance records were modified.');
    } catch (err) {
        console.error('Migration error:', err.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

run();
