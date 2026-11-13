import { parse } from '@babel/parser';
import type { Finding, PullRequest, ReviewFile } from '../shared/types';
import { LIMITS } from '../shared/types';
import { sourceUrl } from '../shared/source';

// A deliberately small structural AST view: no downloaded code is evaluated.
interface Node {
  type: string;
  name?: string;
  value?: unknown;
  loc?: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
}
function node(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Node).type === 'string'
  );
}
function children(n: Node): Node[] {
  const result: Node[] = [];
  for (const [key, value] of Object.entries(n)) {
    if (
      [
        'loc',
        'tokens',
        'comments',
        'leadingComments',
        'trailingComments',
        'innerComments',
        'extra',
      ].includes(key)
    )
      continue;
    if (node(value)) result.push(value);
    else if (Array.isArray(value))
      for (const entry of value) if (node(entry)) result.push(entry);
  }
  return result;
}
function nodes(root: Node): Node[] {
  const result: Node[] = [],
    stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    result.push(current);
    stack.push(...children(current));
  }
  return result;
}
function bindingNames(value: unknown): string[] {
  if (!node(value)) return [];
  if (value.type === 'Identifier') return [value.name!];
  if (value.type === 'ObjectProperty') return bindingNames(value.value);
  if (value.type === 'AssignmentPattern') return bindingNames(value.left);
  return children(value).flatMap(bindingNames);
}
function property(n: unknown, key: string): Node | undefined {
  if (!node(n) || n.type !== 'ObjectExpression' || !Array.isArray(n.properties))
    return;
  const props = n.properties.filter(node);
  if (
    props.some((p) => p.type !== 'ObjectProperty' || p.computed || !node(p.key))
  )
    return;
  const matching = props.filter(
    (p) => (p.key as Node).name === key || (p.key as Node).value === key,
  );
  return matching.length === 1 && node(matching[0].value)
    ? matching[0].value
    : undefined;
}
export function validateReviewFinding(
  finding: Finding,
  file: ReviewFile,
  source: string,
  pr: PullRequest,
): boolean {
  if (
    !pr.headRepo ||
    !['deterministic', 'ai'].includes(finding.source) ||
    !['high', 'medium', 'low'].includes(finding.severity) ||
    !finding.title.trim() ||
    finding.path !== file.path ||
    !Number.isSafeInteger(finding.line) ||
    finding.line < 1 ||
    !finding.explanation.trim() ||
    !finding.recommendation.trim()
  )
    return false;
  const row = file.rows.find(
    (r) => r.kind === 'add' && r.newLine === finding.line,
  );
  return (
    !!row &&
    row.text === finding.evidence &&
    source.split(/\r?\n/)[finding.line - 1] === finding.evidence &&
    finding.sourceUrl ===
      sourceUrl(pr.headRepo, pr.headSha, file.path, finding.line)
  );
}
export function createReviewFinding(
  candidate: Omit<Finding, 'id' | 'source' | 'sourceUrl'>,
  file: ReviewFile,
  source: string,
  pr: PullRequest,
  provenance: Finding['source'] = 'deterministic',
): Finding | undefined {
  if (!pr.headRepo) return;
  const finding: Finding = {
    ...candidate,
    id: `${provenance}:${candidate.ruleId}:${file.path}:${candidate.line}`,
    source: provenance,
    sourceUrl: sourceUrl(pr.headRepo, pr.headSha, file.path, candidate.line),
  };
  return validateReviewFinding(finding, file, source, pr) ? finding : undefined;
}
export function analyzeFile(
  file: ReviewFile,
  source: string,
  pr: PullRequest,
): { findings: Finding[]; reason?: string } {
  if (!pr.headRepo)
    return { findings: [], reason: 'Pinned head repository unavailable.' };
  const sourceLines = source.split(/\r?\n/);
  for (const row of file.rows)
    if (row.newLine !== undefined && sourceLines[row.newLine - 1] !== row.text)
      return {
        findings: [],
        reason: 'Patch does not match pinned head source.',
      };
  let ast: Node;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: [
        ...(/\.[cm]?tsx?$/.test(file.path) ? ['typescript' as const] : []),
        ...(/\.[jt]sx$/.test(file.path) ? ['jsx' as const] : []),
      ],
      errorRecovery: false,
      attachComment: false,
    }) as unknown as Node;
  } catch {
    return {
      findings: [],
      reason: 'Source syntax unsupported or invalid; no speculative findings.',
    };
  }
  const all = nodes(ast);
  if (
    all.some(
      (n) =>
        n.type === 'WithStatement' ||
        (n.type === 'CallExpression' &&
          node(n.callee) &&
          n.callee.type === 'Identifier' &&
          n.callee.name === 'eval'),
    )
  )
    return {
      findings: [],
      reason:
        'Dynamic scope (eval/with) prevents conservative binding resolution.',
    };
  const declared = new Map<string, number>();
  const imports = new Map<string, { library: string; imported: string }>();
  const mutated = new Set<string>();
  const addBindings = (value: unknown) => {
    for (const name of bindingNames(value))
      declared.set(name, (declared.get(name) ?? 0) + 1);
  };
  for (const n of all) {
    if (
      n.type === 'ImportDeclaration' &&
      node(n.source) &&
      Array.isArray(n.specifiers)
    )
      for (const s of n.specifiers.filter(node)) {
        if (
          n.importKind === 'type' ||
          s.importKind === 'type' ||
          !node(s.local)
        )
          continue;
        addBindings(s.local);
        imports.set(s.local.name!, {
          library: String(n.source.value),
          imported:
            s.type === 'ImportDefaultSpecifier'
              ? 'default'
              : s.type === 'ImportNamespaceSpecifier'
                ? '*'
                : node(s.imported)
                  ? String(s.imported.name ?? s.imported.value)
                  : '',
        });
      }
    if (
      n.type === 'VariableDeclarator' ||
      n.type === 'ClassDeclaration' ||
      n.type === 'ClassExpression'
    )
      addBindings(n.id);
    if (/Function|Method/.test(n.type)) {
      addBindings(n.id);
      if (Array.isArray(n.params)) n.params.forEach(addBindings);
    }
    if (n.type === 'CatchClause') addBindings(n.param);
    if (
      [
        'TSEnumDeclaration',
        'TSModuleDeclaration',
        'TSImportEqualsDeclaration',
      ].includes(n.type)
    )
      addBindings(n.id);
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') {
      let target = n.left ?? n.argument;
      while (node(target) && target.type === 'MemberExpression')
        target = target.object;
      for (const name of bindingNames(target)) mutated.add(name);
    }
  }
  // Whole-file shadowing rejection is intentionally stricter than lexical resolution.
  const resolves = (n: unknown, library: string, imported: string): boolean => {
    if (!node(n)) return false;
    if (n.type === 'Identifier') {
      const binding = imports.get(n.name!);
      return (
        declared.get(n.name!) === 1 &&
        !mutated.has(n.name!) &&
        binding?.library === library &&
        binding.imported === imported
      );
    }
    return (
      n.type === 'MemberExpression' &&
      !n.computed &&
      node(n.property) &&
      n.property.name === imported &&
      (resolves(n.object, library, 'default') ||
        resolves(n.object, library, '*'))
    );
  };
  const findings: Finding[] = [];
  const emit = (
    at: Node,
    ruleId: string,
    title: string,
    explanation: string,
    recommendation: string,
  ) => {
    const line = at.loc?.start.line;
    if (
      !line ||
      at.loc?.end.line !== line ||
      findings.length >= LIMITS.findings
    )
      return;
    const finding = createReviewFinding(
      {
        ruleId,
        severity: 'medium',
        title,
        explanation,
        recommendation,
        path: file.path,
        line,
        evidence: sourceLines[line - 1],
      },
      file,
      source,
      pr,
    );
    if (finding && !findings.some((f) => f.id === finding.id))
      findings.push(finding);
  };
  for (const n of all) {
    if (
      n.type === 'BinaryExpression' &&
      ['==', '===', '!=', '!=='].includes(String(n.operator)) &&
      !declared.has('NaN') &&
      !mutated.has('NaN')
    ) {
      const nan = [n.left, n.right].find(
        (x) => node(x) && x.type === 'Identifier' && x.name === 'NaN',
      );
      if (node(nan))
        emit(
          nan,
          'nan-comparison',
          'NaN comparison cannot test for NaN',
          `Comparing with the global NaN using ${String(n.operator)} always yields ${String(n.operator).startsWith('!') ? 'true' : 'false'}. This can select the wrong branch.`,
          'Use Number.isNaN(value) to test the value explicitly.',
        );
    }
    if (
      n.type === 'NewExpression' &&
      (resolves(n.callee, 'node:https', 'Agent') ||
        resolves(n.callee, 'https', 'Agent')) &&
      Array.isArray(n.arguments)
    ) {
      const option = property(n.arguments[0], 'rejectUnauthorized');
      if (option?.type === 'BooleanLiteral' && option.value === false)
        emit(
          option,
          'tls-verification-disabled',
          'HTTPS certificate verification disabled',
          'This HTTPS Agent explicitly disables server certificate verification. The diff alone does not establish exploitability or deployment exposure.',
          'Remove rejectUnauthorized: false; configure a trusted CA when private certificates are required.',
        );
    }
    if (
      n.type === 'CallExpression' &&
      resolves(n.callee, 'jsonwebtoken', 'verify') &&
      Array.isArray(n.arguments)
    ) {
      const option = property(n.arguments[2], 'ignoreExpiration');
      if (option?.type === 'BooleanLiteral' && option.value === true)
        emit(
          option,
          'jwt-expiration-disabled',
          'JWT exp claim validation disabled',
          'This jsonwebtoken.verify call explicitly ignores the exp claim. Other constraints may still apply; this is a manual-review warning, not proof of an authentication bypass.',
          'Remove ignoreExpiration: true unless a separately reviewed flow intentionally handles expired tokens.',
        );
    }
  }
  return { findings };
}
