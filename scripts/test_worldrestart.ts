// Test worldrestart API
async function main() {
    console.log('Testing worldrestart API...');

    try {
        const response = await fetch('http://localhost:3000/api/worldrestart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' })
        });

        const data = await response.json();
        console.log('Response status:', response.status);
        console.log('Response data:', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
