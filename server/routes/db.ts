import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';

// __filename and __dirname are available in CommonJS

const router: Router = express.Router();

// POST /api/db/init - Run migration SQL to ensure schema exists
router.post('/init', async (req, res, next) => {
    try {
        const sqlPath = path.join(__dirname, '..', 'migrations', 'init_database.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await pool.query(sql);
        // Also ensure villages table has housing_capacity column (idempotent)
        await pool.query(`ALTER TABLE villages ADD COLUMN IF NOT EXISTS housing_capacity INTEGER DEFAULT 100`);
        res.json({ success: true, message: 'Database initialized (migrations applied)' });
    } catch (err: unknown) {
        console.error('[API /api/db/init] Migration failed:', err instanceof Error ? err.message : String(err));
        next(err);
    }
});

export default router;
