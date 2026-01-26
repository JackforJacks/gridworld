const pool = require('./server/config/database');

(async () => {
  try {
    const { rows } = await pool.query('SELECT id, food_production_rate FROM villages WHERE food_production_rate IS NOT NULL');
    for (const village of rows) {
      const newRate = village.food_production_rate / 3600;
      await pool.query('UPDATE villages SET food_production_rate = $1 WHERE id = $2', [newRate, village.id]);
      console.log('Updated village', village.id, 'from', village.food_production_rate, 'to', newRate);
    }
    console.log('Updated', rows.length, 'villages');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
})();