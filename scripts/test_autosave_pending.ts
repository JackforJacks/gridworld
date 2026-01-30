(async () => {
    try {
        const StateManager = require('../server/services/stateManager');
        const PeopleState = require('../server/services/populationState/PeopleState');
        const FamilyState = require('../server/services/populationState/FamilyState');
        const storage = require('../server/services/storage');

        console.log('Starting autosave pending test...');

        // Allocate test IDs
        const personId = await PeopleState.getNextId();
        const familyId = await FamilyState.getNextId();

        console.log('Allocated ids -> person:', personId, 'family:', familyId);

        // Ensure storage available
        if (!storage.isAvailable()) {
            console.error('Storage (Redis) is not available; aborting test.');
            process.exit(1);
        }

        // Create a pending person (tracked as new)
        const person = {
            id: personId,
            tile_id: 1,
            residency: 1,
            sex: true,
            date_of_birth: '2000-01-01'
        };
        await PeopleState.addPerson(person, true);
        console.log('Added pending person:', personId);

        // Create a pending family referencing this person as husband
        const family = {
            id: familyId,
            husband_id: personId,
            wife_id: null,
            tile_id: 1,
            pregnancy: false,
            children_ids: []
        };
        await FamilyState.addFamily(family, true);
        console.log('Added pending family:', familyId);

        // Show pending counts
        const pInserts = await storage.scard('pending:person:inserts');
        const fInserts = await storage.scard('pending:family:inserts');
        console.log('Pending inserts -> people:', pInserts, 'families:', fInserts);

        // Call saveToDatabase
        console.log('Invoking StateManager.saveToDatabase()...');
        const res = await StateManager.saveToDatabase();
        console.log('saveToDatabase result:', res);

        // Validate that saved entries are no longer pending (or were inserted)
        const pInsertsAfter = await storage.scard('pending:person:inserts');
        const fInsertsAfter = await storage.scard('pending:family:inserts');
        console.log('Pending inserts after save -> people:', pInsertsAfter, 'families:', fInsertsAfter);

        // Cleanup: if any pending flags remain, remove them
        if (pInsertsAfter > 0) await storage.del('pending:person:inserts');
        if (fInsertsAfter > 0) await storage.del('pending:family:inserts');

        console.log('Test complete.');
        process.exit(0);
    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
})();