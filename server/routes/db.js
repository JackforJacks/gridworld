const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

// POST /api/db/init - Run migration SQL to ensure schema exists
router.post('/init', async (req, res, next) => {
    try {
        const sqlPath = path.join(__dirname, '..', 'migrations', 'init_database.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await pool.query(sql);
        // Also ensure villages table has housing_capacity column (idempotent)
        await pool.query(`ALTER TABLE villages ADD COLUMN IF NOT EXISTS housing_capacity INTEGER DEFAULT 100`);
        res.json({ success: true, message: 'Database initialized (migrations applied)' });
    } catch (err) {
        console.error('[API /api/db/init] Migration failed:', err && err.message ? err.message : err);
        next(err);
    }
});

module.exports = router;
