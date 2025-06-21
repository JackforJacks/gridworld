// server/services/population/calculator.js

function getRandomSex() {
    return Math.random() < 0.51;
}

function getRandomAge() {
    const rand = Math.random();
    if (rand < 0.05) { // 5% elderly (61-90)
        return 61 + Math.floor(Math.random() * 30);
    } else {
        // 95% non-elderly (0-60), split for median 22
        const nonElderlyRand = Math.random();
        if (nonElderlyRand < 0.5) {
            // 0-22 (50% of non-elderly)
            return Math.floor(Math.random() * 23);
        } else {
            // 23-60 (50% of non-elderly)
            return 23 + Math.floor(Math.random() * 38);
        }
    }
}

function calculateAge(birthDate, currentYear, currentMonth, currentDay) {
    let birthYear, birthMonth, birthDay;

    if (typeof birthDate === 'string') {
        [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
    } else if (birthDate instanceof Date) {
        birthYear = birthDate.getFullYear();
        birthMonth = birthDate.getMonth() + 1; // JS months are 0-indexed
        birthDay = birthDate.getDate();
    } else {
        console.error('Invalid birthDate format:', birthDate);
        return 0;
    }

    let age = currentYear - birthYear;
    if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
        age--;
    }
    return Math.max(0, age);
}

function getRandomBirthDate(currentYear, currentMonth, currentDay, age) {
    let birthYear = currentYear - age;
    let birthMonth = Math.floor(Math.random() * 12) + 1; // 12 months per year

    // Custom calendar has 8 days per month, not 28-31 like standard calendar
    let birthDay = Math.floor(Math.random() * 8) + 1; // 1-8 days per month

    // Ensure the birth date is valid for the current context
    if (birthYear === currentYear) {
        if (birthMonth > currentMonth) birthMonth = currentMonth;
        if (birthMonth === currentMonth && birthDay > currentDay) birthDay = currentDay;
    }

    return `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
}

// --- Rate Tracking Functions ---
// (Moved to PopStats.js)

module.exports = {
    getRandomSex,
    getRandomAge,
    calculateAge,
    getRandomBirthDate
};
