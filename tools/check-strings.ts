// Все русские подписи интерфейса живут в editor/strings.ts: в остальных editor/*.ts кириллицы в литералах быть не должно.
// Комментарии и регексы не считаются — смотрим только литералы и статические части шаблонов (AST).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CYRILLIC = /\p{Script=Cyrillic}/u;
const EDITOR_DIR = 'editor';
const STRINGS_NAME = 'strings.ts';
const ROOT_NAME = 'EDITOR_STRINGS';

interface Finding { file: string; line: number; text: string; }

function cyrillicLiterals(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const add = (text: string, pos: number): void => {
    if (CYRILLIC.test(text)) found.push({ file, line: sf.getLineAndCharacterOfPosition(pos).line + 1, text });
  };
  const walk = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node.getStart(sf));
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head.getStart(sf));
      for (const span of node.templateSpans) add(span.literal.text, span.literal.getStart(sf));
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

function selfTest(): void {
  const fixture = [
    "const a = 'русский литерал';",
    '// комментарий: русский текст',
    'const re = /русский/;',
    'const t = `до ${a} после`;',
  ].join('\n');
  const got = cyrillicLiterals('fixture.ts', fixture).map((f) => f.text);
  const want = ['русский литерал', 'до ', ' после'];
  if (got.length !== want.length || got.some((text, i) => text !== want[i])) {
    console.error(`FAIL самотеста: ожидалось ${JSON.stringify(want)}, найдено ${JSON.stringify(got)}`);
    process.exit(1);
  }
  console.log('самотест PASS: литерал и шаблон найдены; комментарий и регекс не считаются');
}

function editorFiles(): string[] {
  return fs.readdirSync(EDITOR_DIR).filter((name) => name.endsWith('.ts') && name !== STRINGS_NAME).sort();
}

function leafPaths(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const leaves: string[] = [];
  const collect = (node: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(sf);
      const full = prefix ? `${prefix}.${name}` : name;
      if (ts.isObjectLiteralExpression(prop.initializer)) collect(prop.initializer, full);
      else leaves.push(full);
    }
  };
  const unwrap = (node: ts.Expression): ts.Expression => {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return unwrap(node.expression);
    return node;
  };
  const find = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === ROOT_NAME && node.initializer) {
      const value = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(value)) collect(value, '');
      return;
    }
    ts.forEachChild(node, find);
  };
  find(sf);
  return leaves;
}

function usedPaths(files: string[]): { paths: Set<string>; wholeObject: boolean } {
  const paths = new Set<string>();
  let wholeObject = false;
  for (const file of files) {
    const sf = ts.createSourceFile(`${EDITOR_DIR}/${file}`, fs.readFileSync(path.join(EDITOR_DIR, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const chain = (node: ts.Expression): string | null => {
      if (ts.isIdentifier(node)) return node.text === ROOT_NAME ? '' : null;
      if (ts.isPropertyAccessExpression(node)) {
        const left = chain(node.expression);
        return left === null ? null : left ? `${left}.${node.name.text}` : node.name.text;
      }
      if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
        const left = chain(node.expression);
        return left === null ? null : left ? `${left}.${node.argumentExpression.text}` : node.argumentExpression.text;
      }
      return null;
    };
    const walk = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const parent = node.parent;
        const isPrefix = ts.isPropertyAccessExpression(parent) && parent.expression === node;
        if (!isPrefix) {
          const full = chain(node);
          if (full) paths.add(full);
        }
      } else if (ts.isIdentifier(node) && node.text === ROOT_NAME) {
        const parent = node.parent;
        const isRoot = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
        if (!isRoot && !ts.isImportSpecifier(parent) && !ts.isQualifiedName(parent)) wholeObject = true;
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return { paths, wholeObject };
}

selfTest();

const files = editorFiles();
const findings = files.flatMap((name) => cyrillicLiterals(`${EDITOR_DIR}/${name}`, fs.readFileSync(path.join(EDITOR_DIR, name), 'utf8')));
for (const issue of findings) console.error(`${issue.file}:${issue.line}: ${issue.text}`);

const leaves = leafPaths(`${EDITOR_DIR}/${STRINGS_NAME}`, fs.readFileSync(path.join(EDITOR_DIR, STRINGS_NAME), 'utf8'));
const usage = usedPaths(files);
const referenced = [...usage.paths];
const unused = usage.wholeObject ? [] : leaves.filter((leaf) => !referenced.some((used) => leaf === used || used.startsWith(`${leaf}.`) || leaf.startsWith(`${used}.`)));
for (const leaf of unused) console.warn(`WARN: не используется ключ ${ROOT_NAME}.${leaf}`);

if (findings.length) {
  console.error(`check:strings FAILED: кириллических литералов ${findings.length}`);
  process.exit(1);
}
console.log(`кириллических литералов нет (файлов editor/*.ts: ${files.length}, ключей ${ROOT_NAME}: ${leaves.length}, неиспользуемых: ${unused.length})`);
console.log('check:strings OK');
