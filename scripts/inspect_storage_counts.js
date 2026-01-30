const storage = require('../server/services/storage');

(async () => {
  try {
    const villageData = await storage.hgetall('village');
    const personData = await storage.hgetall('person');
    console.log({
      villageCount: villageData ? Object.keys(villageData).length : 0,
      personCount: personData ? Object.keys(personData).length : 0
    });
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
