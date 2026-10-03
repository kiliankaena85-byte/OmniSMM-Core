/**
 * run-ast-guardrails.ts
 * Нативный TypeScript AST-валидатор архитектурных инвариантов платформы OmniSMM 1.0.
 * Использует официальный TypeScript Compiler API (ts.createSourceFile).
 * Не требует внешних бинарников (ast-grep), работает на любой ОС с субсекундной скоростью.
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export interface GuardrailViolation {
  ruleId: string;
  severity: 'BLOCKER' | 'MAJOR' | 'WARNING';
  file: string;
  line: number;
  message: string;
  snippet: string;
}

export class AstGuardrailsEngine {
  private projectRoot: string;
  private violations: GuardrailViolation[] = [];

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Рекурсивный поиск файлов в директории
   */
  private getSourceFiles(dir: string, extensions = ['.ts', '.tsx']): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!['node_modules', '.next', 'dist', '.git', '.planning', '.agents'].includes(file)) {
          results.push(...this.getSourceFiles(fullPath, extensions));
        }
      } else if (extensions.some((ext) => file.endsWith(ext)) && !file.endsWith('.d.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  /**
   * Анализ отдельного файла через TypeScript AST
   */
  public analyzeFile(filePath: string): void {
    const relPath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const isClientFile = content.includes("'use client'") || content.includes('"use client"');
    const isPageFile = /src\/app\/.*\/page\.tsx?$/.test(relPath);
    const isActionFile = relPath.startsWith('src/actions/');
    const isFinancialFile = /src\/(lib\/(wallet-ops|exact-math)|services\/(billing|finance|payment))/.test(relPath);

    const lines = content.split('\n');
    const getSnippet = (node: ts.Node): string => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      return (lines[line] || '').trim();
    };
    const getLine = (node: ts.Node): number => {
      return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    };

    // -------------------------------------------------------------
    // ПРАВИЛО 2: Запрет "use server" в page.tsx
    // -------------------------------------------------------------
    if (isPageFile && (content.includes('"use server"') || content.includes("'use server'"))) {
      const line = lines.findIndex((l) => l.includes('use server')) + 1;
      this.violations.push({
        ruleId: 'no-use-server-in-page',
        severity: 'BLOCKER',
        file: relPath,
        line: line > 0 ? line : 1,
        message: 'Директива "use server" внутри page.tsx запрещена! Выносите Server Actions строго в src/actions/.',
        snippet: lines[line - 1]?.trim() || '"use server"',
      });
    }

    // -------------------------------------------------------------
    // ПРАВИЛО 3: Запрет импорта Prisma в клиентских компонентах
    // -------------------------------------------------------------
    if (isClientFile) {
      ts.forEachChild(sourceFile, (node) => {
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, '');
          if (moduleSpecifier === '@/lib/db' || moduleSpecifier === '@prisma/client' || moduleSpecifier.includes('prisma')) {
            const isClauseTypeOnly = node.importClause?.isTypeOnly ?? false;
            let hasRuntimeSpecifier = false;

            if (!isClauseTypeOnly && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
              hasRuntimeSpecifier = node.importClause.namedBindings.elements.some((el) => !el.isTypeOnly);
            } else if (!isClauseTypeOnly) {
              hasRuntimeSpecifier = true;
            }

            if (hasRuntimeSpecifier) {
              this.violations.push({
                ruleId: 'no-prisma-in-client',
                severity: 'BLOCKER',
                file: relPath,
                line: getLine(node),
                message: 'Runtime импорт Prisma Client в клиентском компоненте "use client" строго запрещен (утечка БД/краш бандла)! Используйте "import type { ... }".',
                snippet: getSnippet(node),
              });
            }
          }
        }
      });
    }

    // -------------------------------------------------------------
    // Глубокий рекурсивный обход AST с контекстным скоупом
    // -------------------------------------------------------------
    const visitNode = (node: ts.Node, txParam: string | null) => {
      // -------------------------------------------------------------
      // ПРАВИЛО 1: Детекция Transaction Escape (db.* внутри tx-колбэка)
      // -------------------------------------------------------------
      if (txParam && ts.isPropertyAccessExpression(node)) {
        const objText = node.expression.getText(sourceFile);
        const propName = node.name.getText(sourceFile);

        // Исключаем вызов вложенных транзакций или не-db объектов
        if (objText === 'db' && propName !== '$transaction' && !filePath.includes('.test.')) {
          this.violations.push({
            ruleId: 'no-transaction-escape',
            severity: 'BLOCKER',
            file: relPath,
            line: getLine(node),
            message: `Обнаружен Transaction Escape: обращение к глобальному 'db.${propName}' внутри транзакции! Используйте '${txParam}.${propName}'.`,
            snippet: getSnippet(node),
          });
        }
      }

      // -------------------------------------------------------------
      // ПРАВИЛО 5: Server Actions не должны выбрасывать сырой throw
      // -------------------------------------------------------------
      if (isActionFile && ts.isThrowStatement(node)) {
        let current: ts.Node | undefined = node.parent;
        let isInsideCatch = false;
        let isSafeWrapper = false;
        
        while (current) {
          if (ts.isCatchClause(current)) {
            isInsideCatch = true;
            break;
          }
          if (ts.isCallExpression(current)) {
            const callText = current.expression.getText(sourceFile);
            if (
              callText === 'requireStaffPermission' ||
              callText === 'runSerializableTransaction' ||
              callText === 'requireOperatorPermission' ||
              callText.endsWith('.$transaction')
            ) {
              isSafeWrapper = true;
              break;
            }
          }
          current = current.parent;
        }

        if (!isInsideCatch && !isSafeWrapper && !filePath.includes('.test.')) {
          this.violations.push({
            ruleId: 'server-action-typed-return',
            severity: 'WARNING',
            file: relPath,
            line: getLine(node),
            message: 'Сырой "throw new Error" в Server Action. Рекомендуется возвращать типизированный { success: false, error: "..." }.',
            snippet: getSnippet(node),
          });
        }
      }

      // -------------------------------------------------------------
      // ПРАВИЛО 6: Сетевой fetch(...) обязан содержать signal/timeout
      // -------------------------------------------------------------
      if (ts.isCallExpression(node)) {
        const fnName = node.expression.getText(sourceFile);
        if (fnName === 'fetch' && !filePath.includes('.test.') && !filePath.includes('scripts/')) {
          const args = node.arguments;
          let hasSignal = false;

          let secondArg = args.length >= 2 ? args[1] : undefined;
          while (
            secondArg &&
            (ts.isAsExpression(secondArg) ||
              ts.isTypeAssertionExpression(secondArg) ||
              ts.isParenthesizedExpression(secondArg))
          ) {
            secondArg = secondArg.expression;
          }

          if (secondArg && ts.isObjectLiteralExpression(secondArg)) {
            hasSignal = secondArg.properties.some((prop) => {
              if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
                return prop.name.getText(sourceFile) === 'signal';
              }
              return false;
            });
          }

          if (!hasSignal) {
            this.violations.push({
              ruleId: 'fetch-timeout-required',
              severity: 'MAJOR',
              file: relPath,
              line: getLine(node),
              message: 'Вызов fetch(...) без опции "signal: AbortSignal.timeout(...)". Несет риск зависания соединения.',
              snippet: getSnippet(node),
            });
          }
        }
      }

      // -------------------------------------------------------------
      // Особая обработка $transaction вызовов:
      // Передаем имя транзакционного параметра ТОЛЬКО внутрь аргумента-колбэка
      // -------------------------------------------------------------
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (text.endsWith('$transaction') && node.arguments.length > 0) {
          // Обрабатываем выражение db.$transaction без флага escape
          visitNode(node.expression, txParam);

          // Обрабатываем аргументы
          node.arguments.forEach((arg) => {
            if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
              let innerTxName = 'tx';
              if (arg.parameters.length > 0) {
                innerTxName = arg.parameters[0].name.getText(sourceFile);
              }
              // Обходим тело колбэка с передачей innerTxName
              arg.forEachChild((child) => visitNode(child, innerTxName));
            } else {
              visitNode(arg, txParam);
            }
          });
          return;
        }
      }

      // Рекурсивный спуск ко всем дочерним узлам с сохранением текущего контекста транзакции
      ts.forEachChild(node, (child) => visitNode(child, txParam));
    };

    visitNode(sourceFile, null);
  }

  /**
   * Сканирование всей директории src/
   */
  public run(targetDir = 'src'): { violations: GuardrailViolation[]; passed: boolean } {
    console.log(`🛡️ [AST Guardrails] Scanning '${targetDir}' for architectural invariants...\n`);
    const fullTarget = path.resolve(this.projectRoot, targetDir);
    const files = this.getSourceFiles(fullTarget);

    console.log(`📦 Found ${files.length} TypeScript source files.`);
    const startTime = Date.now();

    for (const file of files) {
      try {
        this.analyzeFile(file);
      } catch (e) {
        console.error(`Error parsing file ${file}:`, e);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ AST analysis completed in ${elapsed}s.\n`);

    const blockers = this.violations.filter((v) => v.severity === 'BLOCKER');
    const majors = this.violations.filter((v) => v.severity === 'MAJOR');
    const warnings = this.violations.filter((v) => v.severity === 'WARNING');

    console.log('📊 AST Guardrails Audit Results:');
    console.log(`   - 🛑 BLOCKERS: ${blockers.length}`);
    console.log(`   - ⚠️ MAJORS:   ${majors.length}`);
    console.log(`   - ℹ️ WARNINGS: ${warnings.length}`);

    if (this.violations.length > 0) {
      console.log('\n🔍 Detailed Violations:');
      this.violations.forEach((v, idx) => {
        const icon = v.severity === 'BLOCKER' ? '🛑' : v.severity === 'MAJOR' ? '⚠️' : 'ℹ️';
        console.log(`\n[${idx + 1}] ${icon} [${v.severity}] Rule: ${v.ruleId}`);
        console.log(`    File: ${v.file}:${v.line}`);
        console.log(`    Message: ${v.message}`);
        console.log(`    Snippet: "${v.snippet}"`);
      });
    }

    const passed = blockers.length === 0;

    if (passed) {
      console.log('\n🟢 [AST Guardrails PASS] Zero blockers found! Architecture is clean.');
    } else {
      console.log('\n🔴 [AST Guardrails FAIL] Critical architectural violations must be fixed.');
    }

    return { violations: this.violations, passed };
  }
}

// CLI Execution
if (process.argv[1]?.includes('run-ast-guardrails.ts')) {
  const engine = new AstGuardrailsEngine();
  const { passed } = engine.run('src');
  if (!passed) {
    process.exit(1);
  }
}
