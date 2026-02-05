/**
 * Diagnostic script to check eligible sets and verify sex values match
 * Run with: npx ts-node scripts/check_eligible_sets.ts
 */

import storage from '../server/services/storage';

async function checkEligibleSets() {
    // Wait for storage to be ready
    await storage.waitForReady();

    console.log('Checking eligible sets...\n');

    // Get all tiles with eligible males/females
    const tilesWithMales = await storage.smembers('tiles_with_eligible_males') || [];
    const tilesWithFemales = await storage.smembers('tiles_with_eligible_females') || [];

    console.log(`Tiles with eligible males: ${tilesWithMales.length}`);
    console.log(`Tiles with eligible females: ${tilesWithFemales.length}`);
    console.log('');

    let totalMalesCorrect = 0;
    let totalMalesWrong = 0;
    let totalFemalesCorrect = 0;
    let totalFemalesWrong = 0;

    // Check a sample of males
    for (const tileId of tilesWithMales.slice(0, 5)) {
        const maleSetKey = `eligible:males:tile:${tileId}`;
        const members = await storage.smembers(maleSetKey) || [];
        
        console.log(`\n--- Tile ${tileId} - Males Set (${members.length} members) ---`);
        
        for (const personId of members.slice(0, 3)) {
            const personJson = await storage.hget('person', personId);
            if (personJson) {
                const person = JSON.parse(personJson);
                const isCorrect = person.sex === true;
                if (isCorrect) totalMalesCorrect++;
                else totalMalesWrong++;
                
                console.log(`  Person ${personId}: sex=${person.sex} (${typeof person.sex}) - ${isCorrect ? '✅ CORRECT' : '❌ WRONG (should be true/male)'}`);
            } else {
                console.log(`  Person ${personId}: NOT FOUND in person hash`);
            }
        }
    }

    // Check a sample of females
    for (const tileId of tilesWithFemales.slice(0, 5)) {
        const femaleSetKey = `eligible:females:tile:${tileId}`;
        const members = await storage.smembers(femaleSetKey) || [];
        
        console.log(`\n--- Tile ${tileId} - Females Set (${members.length} members) ---`);
        
        for (const personId of members.slice(0, 3)) {
            const personJson = await storage.hget('person', personId);
            if (personJson) {
                const person = JSON.parse(personJson);
                const isCorrect = person.sex === false;
                if (isCorrect) totalFemalesCorrect++;
                else totalFemalesWrong++;
                
                console.log(`  Person ${personId}: sex=${person.sex} (${typeof person.sex}) - ${isCorrect ? '✅ CORRECT' : '❌ WRONG (should be false/female)'}`);
            } else {
                console.log(`  Person ${personId}: NOT FOUND in person hash`);
            }
        }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Males set: ${totalMalesCorrect} correct, ${totalMalesWrong} wrong`);
    console.log(`Females set: ${totalFemalesCorrect} correct, ${totalFemalesWrong} wrong`);

    if (totalMalesWrong > 0 || totalFemalesWrong > 0) {
        console.log('\n⚠️  INCONSISTENCY DETECTED: Some people are in the wrong eligible set!');
    } else {
        console.log('\n✅ All checked entries are correctly placed.');
    }

    // Clean exit
    process.exit(0);
}

checkEligibleSets().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
