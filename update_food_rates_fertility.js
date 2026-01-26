const pool = require('./server/config/database');
const villageService = require('./server/services/villageService');

(async () => {
  try {
    const { rows } = await pool.query('SELECT id FROM villages');
    for (const { id } of rows) {
      await villageService.updateVillageFoodProduction(id);
      console.log('Updated village', id);
    }
    console.log('Updated all villages');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
})();