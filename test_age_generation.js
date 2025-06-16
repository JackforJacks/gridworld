const { getRandomAge, getRandomBirthDate, calculateAge } = require('./server/services/population/calculator.js');

// Test the age generation
console.log('Testing age generation...');

// Test what current date is being used
const currentYear = 2025;
const currentMonth = 6;
const currentDay = 16;

console.log(`Current date being used: ${currentYear}-${currentMonth}-${currentDay}`);

// Generate 10 random people and check their ages
for (let i = 0; i < 10; i++) {
    const randomAge = getRandomAge();
    const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, randomAge);
    const calculatedAge = calculateAge(birthDate, currentYear, currentMonth, currentDay);
    
    console.log(`Person ${i + 1}: Expected age ${randomAge}, Birth date ${birthDate}, Calculated age ${calculatedAge}`);
}

// Test with specific ages
console.log('\nTesting specific ages...');
const testAges = [25, 45, 70];
for (const age of testAges) {
    const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
    const calculatedAge = calculateAge(birthDate, currentYear, currentMonth, currentDay);
    console.log(`Age ${age}: Birth date ${birthDate}, Calculated age ${calculatedAge}`);
}
