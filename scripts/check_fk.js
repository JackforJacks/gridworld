const pool = require('../server/config/database');

(async () => {
  const q = 'SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, rc.delete_rule FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name WHERE tc.constraint_type = ''FOREIGN KEY'' AND tc.table_name = ''tiles_lands''';
  const {rows} = await pool.query(q);
  console.log('tiles_lands Foreign Keys:', rows);
  process.exit(0);
})();
