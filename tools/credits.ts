import fs from 'node:fs';
import path from 'node:path';
import { collectCredits, formatCredits } from '../engine/credits.ts';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run credits -- <project.json>');
const project = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
const credits = collectCredits(project);
console.log(formatCredits(credits));
