// CalendarState DB Model/Helper
import pool from '../config/database';

const TABLE = 'calendar_state';

export async function getCalendarState() {
    const res = await pool.query(`SELECT * FROM ${TABLE} LIMIT 1`);
    return res.rows[0];
}

export async function setCalendarState({ year, month, day }) {
    // Upsert: update if exists, else insert
    const res = await pool.query(
        `INSERT INTO ${TABLE} (current_year, current_month, current_day, last_updated)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET current_year = $1, current_month = $2, current_day = $3, last_updated = NOW()
         RETURNING *`,
        [year, month, day]
    );
    return res.rows[0];
}
