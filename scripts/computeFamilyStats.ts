#!/usr/bin/env node
const pool = require('../server/config/database');

(async function run() {
    try {
        const res = await pool.query(`
            SELECT
                COUNT(*)::int AS total_families,
                COUNT(*) FILTER (WHERE pregnancy) AS pregnant_families,
                COUNT(*) FILTER (WHERE array_length(children_ids,1) IS NOT NULL AND array_length(children_ids,1) > 0) AS families_with_children,
                COALESCE(SUM(COALESCE(array_length(children_ids,1),0)),0) AS total_children
            FROM family;
        `);
        const row = res.rows[0] || {};
        const total = Number(row.total_families || 0);
        const familiesWithChildren = Number(row.families_with_children || 0);
        const totalChildren = Number(row.total_children || 0);
        const avgChildren = total > 0 ? (totalChildren / total) : 0;

        console.log(`totalFamilies: ${total}`);
        console.log(`pregnantFamilies: ${Number(row.pregnant_families || 0)}`);
        console.log(`familiesWithChildren: ${familiesWithChildren}`);
        console.log(`totalChildren: ${totalChildren}`);
        console.log(`avgChildrenPerFamily: ${avgChildren.toFixed(1)}`);
    } catch (err) {
        console.error('Error querying database:', err && err.message ? err.message : err);
        process.exitCode = 2;
    } finally {
        try { await pool.end(); } catch (_) { }
    }
})();
