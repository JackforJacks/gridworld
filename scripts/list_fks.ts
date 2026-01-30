const pool = require('../server/config/database');

(async () => {
    // Check what tables reference people table
    const { rows } = await pool.query(`
    SELECT tc.table_name as referencing_table, kcu.column_name, ccu.table_name as referenced_table, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
  `);
    console.log('All FKs in database:');
    rows.forEach(r => console.log('  ', r.referencing_table, '.', r.column_name, '->', r.referenced_table, 'ON DELETE', r.delete_rule));
    process.exit(0);
})();
