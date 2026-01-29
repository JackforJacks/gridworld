// Simple script to regenerate tiles via HTTP API
const http = require('http');

const url = 'http://localhost:3000/api/tiles?regenerate=true&silent=1';

console.log('Regenerating tiles...');

http.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log(`Response status: ${res.statusCode}`);
        console.log('Response:', data.slice(0, 500));
    });
}).on('error', (e) => {
    console.error('Error:', e.message);
});
