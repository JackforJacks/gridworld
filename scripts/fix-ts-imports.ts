#!/usr/bin/env ts-node
/**
 * Auto-fix common TypeScript migration issues
 * - Add .js extension to .ts in imports
 * - Fix require() to import statements where appropriate
 * - Add type annotations for common patterns
 */

import * as fs from 'fs';
import * as path from 'path';

function fixImportsInFile(filePath: string): void {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Fix .js imports to .ts
  const jsImportRegex = /(from\s+['"]\.\.?\/[^'"]+)\.js(['"])/g;
  if (jsImportRegex.test(content)) {
    content = content.replace(jsImportRegex, '$1$2');
    modified = true;
  }

  // Fix require('./something.js') to import
  const requireJsRegex = /require\(['"]\.\.?\/([^'"]+)\.js['"]\)/g;
  if (requireJsRegex.test(content)) {
    content = content.replace(requireJsRegex, `require('./$1')`);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed: ${filePath}`);
  }
}

function walkDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) {
        walkDirectory(fullPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      fixImportsInFile(fullPath);
    }
  }
}

const rootDir = path.resolve(__dirname, '..');
console.log('Fixing TypeScript imports...');
walkDirectory(path.join(rootDir, 'server'));
walkDirectory(path.join(rootDir, 'src'));
console.log('Done!');
