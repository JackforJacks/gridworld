import PeopleState from '../server/services/populationState/PeopleState';

async function runRepair() {
    try {
        console.log('🔧 Running PeopleState.repairIfNeeded()...');
        const res = await PeopleState.repairIfNeeded();
        console.log('Result:', res);
    } catch (e) {
        console.error('Repair failed:', e);
    }
}

(async () => {
    try {
        await runRepair();
        process.exit(0);
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
})();