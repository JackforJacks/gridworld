// server/services/population/calculator.js

function getRandomSex() {
    return Math.random() < 0.51;
}

function getRandomAge() {
    const rand = Math.random();
    if (rand < 0.20) { // 20% minors (0-15)
        return Math.floor(Math.random() * 16);
    } else if (rand < 0.65) { // 45% working age (16-60)
        return 16 + Math.floor(Math.random() * 45);
    } else { // 35% elderly (61-90)
        return 61 + Math.floor(Math.random() * 30);
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
    let birthMonth = Math.floor(Math.random() * 12) + 1;
    let birthDay = Math.floor(Math.random() * 8) + 1;
    if (birthYear === currentYear) {
        if (birthMonth > currentMonth) birthMonth = currentMonth;
        if (birthMonth === currentMonth && birthDay > currentDay) birthDay = currentDay;
    }
    if (birthDay > 8) birthDay = 8;
    if (birthMonth > 12) birthMonth = 12;
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
