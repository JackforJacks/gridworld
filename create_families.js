async function createFamilies() {
    try {
        const response = await fetch('http://localhost:3000/api/population/create-families', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        console.log('Family creation result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error creating families:', error);
    }
}

createFamilies();
