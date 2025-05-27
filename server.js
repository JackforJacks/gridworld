// Simple Node.js static file server for the GridWorld application
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    
    // Handle root URL
    let filePath = req.url === '/' ? './index.html' : '.' + req.url;
    
    // Get the file extension
    const extname = path.extname(filePath).toLowerCase();
    
    // Set the content type header
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';
    
    // Read and serve the file
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File not found
                console.log(`File not found: ${filePath}`);
                res.writeHead(404);
                res.end('404 Not Found');
            } else {
                // Server error
                console.error(`Server error: ${err.code}`);
                res.writeHead(500);
                res.end('500 Internal Server Error');
            }
        } else {
            // Success response
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}).listen(PORT);

console.log(`Server running at http://localhost:${PORT}/`);
console.log(`Press Ctrl+C to stop the server`);
