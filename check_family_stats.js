async function checkFamilyStats() {
    console.log('Starting family stats check...');
    try {
        console.log('Fetching stats from API...');
        const response = await fetch('http://localhost:3000/api/population/stats');
        console.log('Response status:', response.status);        const result = await response.json();
        console.log('Family Statistics:');
        console.log('- Total Families:', result.totalFamilies || 0);
        console.log('- Pregnant Families:', result.pregnantFamilies || 0);
        console.log('- Families with Children:', result.familiesWithChildren || 0);
        console.log('- Average Children per Family:', (result.avgChildrenPerFamily || 0).toFixed(2));
        
        console.log('\nOther Stats:');
        console.log('- Total Population:', result.totalPopulation || 0);
        console.log('- Birth Rate:', (result.birthRate || 0).toFixed(2));
        console.log('- Death Rate:', (result.deathRate || 0).toFixed(2));
        console.log('- Birth Count:', result.birthCount || 0);
        console.log('- Death Count:', result.deathCount || 0);
        
    } catch (error) {
        console.error('Error fetching family stats:', error);
    }
}

console.log('Script starting...');
checkFamilyStats().then(() => {
    console.log('Script completed');
}).catch(err => {
    console.error('Script error:', err);
});
