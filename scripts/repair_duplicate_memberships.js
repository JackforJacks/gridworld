const PeopleState = require('../server/services/populationState/PeopleState');

async function runRepair() {
  try {
    console.log('🔧 Running PeopleState.repairIfNeeded()...');
    const res = await PeopleState.repairIfNeeded();
    console.log('Result:', res);
  } catch (e) {
    console.error('Repair failed:', e);
  }
}

runRepair().then(() => process.exit(0));