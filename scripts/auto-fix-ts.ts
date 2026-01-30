/**
 * Automated TypeScript Migration Fixer
 * Run with: ts-node scripts/auto-fix-ts.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface FixStats {
  filesProcessed: number;
  filesModified: number;
  fixesApplied: number;
}

const stats: FixStats = {
  filesProcessed: 0,
  filesModified: 0,
  fixesApplied: 0
};

function applyFixes(filePath: string, content: string): string {
  let modified = content;
  let changeCount = 0;

  // Fix 1: Convert require to import for common modules
  const requirePatterns = [
    [/const\s+(\w+)\s*=\s*require\(['"]pg['"]\);/g, "import pg from 'pg';"],
    [/const\s+{\s*Pool\s*}\s*=\s*require\(['"]pg['"]\);/g, "import { Pool } from 'pg';"],
    [/const\s+express\s*=\s*require\(['"]express['"]\);/g, "import express from 'express';"],
    [/const\s+Redis\s*=\s*require\(['"]ioredis['"]\);/g, "import Redis from 'ioredis';"],
    [/const\s+dotenv\s*=\s*require\(['"]dotenv['"]\);/g, "import dotenv from 'dotenv';"],
  ];

  for (const [pattern, replacement] of requirePatterns) {
    const regex = pattern as RegExp;
    if (regex.test(modified)) {
      modified = modified.replace(regex, replacement as string);
      changeCount++;
    }
  }

  // Fix 2: Add type annotations to common parameters
  modified = modified.replace(
    /\.on\(['"]error['"],\s*\((\w+)\)\s*=>/g,
    (match, param) => `.on('error', (${param}: Error) =>`
  );
  changeCount += (modified.match(/: Error\) =>/g) || []).length;

  // Fix 3: Fix parseInt with env variables
  modified = modified.replace(
    /parseInt\(process\.env\.(\w+),\s*10\)/g,
    (match, envVar) => `parseInt(process.env.${envVar} || '0', 10)`
  );

  // Fix 4: Fix process.env string access with fallback
  modified = modified.replace(
    /process\.env\.(\w+)\s*\|\|\s*'([^']+)'/g,
    (match, envVar, fallback) => `(process.env.${envVar} || '${fallback}')`
  );

  // Fix 5: Add any type to callback parameters (temporary)
  modified = modified.replace(
    /\((\w+),\s*(\w+),\s*(\w+)\)\s*=>\s*{/g,
    (match, p1, p2, p3) => {
      if (match.includes('err') || match.includes('error')) {
        return `(${p1}: any, ${p2}: any, ${p3}: any) => {`;
      }
      return match;
    }
  );

  // Fix 6: Add type for rest parameters
  modified = modified.replace(
    /\.\.\.(args|rargs|members|keys)\)/g,
    '...$1: any[])'
  );

  // Fix 7: Remove .js from relative imports
  modified = modified.replace(
    /(from\s+['"])([\.\/][^'"]+)\.js(['"])/g,
    '$1$2$3'
  );

  if (changeCount > 0) {
    stats.fixesApplied += changeCount;
  }

  return modified;
}

function processFile(filePath: string): void {
  stats.filesProcessed++;
  
  try {
    const original = fs.readFileSync(filePath, 'utf-8');
    const fixed = applyFixes(filePath, original);
    
    if (original !== fixed) {
      fs.writeFileSync(filePath, fixed, 'utf-8');
      stats.filesModified++;
      console.log(`✓ Fixed: ${path.relative(process.cwd(), filePath)}`);
    }
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error);
  }
}

function walkDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) {
        walkDirectory(fullPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      processFile(fullPath);
    }
  }
}

// Main execution
console.log('🔧 Starting automated TypeScript migration fixes...\n');

const rootDir = process.cwd();
walkDirectory(path.join(rootDir, 'server'));
walkDirectory(path.join(rootDir, 'src'));

console.log('\n📊 Migration Stats:');
console.log(`   Files processed: ${stats.filesProcessed}`);
console.log(`   Files modified: ${stats.filesModified}`);
console.log(`   Fixes applied: ${stats.fixesApplied}`);
console.log('\n✅ Automated fixes complete!');
console.log('⚠️  Manual review still required for complex type issues.');
