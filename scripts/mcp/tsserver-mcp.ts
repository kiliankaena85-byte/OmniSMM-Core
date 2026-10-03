import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import ts from 'typescript';

// Обертка вокруг tsserver / TypeScript Compiler API для MCP
const server = new McpServer({
  name: "tsserver-mcp",
  version: "1.0.0"
});

const tsconfigPath = path.resolve(process.cwd(), 'tsconfig.json');

let ls: ts.LanguageService;
let parsedFiles: Set<string>;

function getOrCreateLanguageService() {
  if (ls) return ls;

  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  
  // Force declaration emit
  parsed.options.noEmit = false;
  parsed.options.declaration = true;
  parsed.options.emitDeclarationOnly = true;

  parsedFiles = new Set(parsed.fileNames);

  const files: ts.MapLike<{ version: number }> = {};
  parsed.fileNames.forEach(fileName => {
    files[fileName] = { version: 0 };
  });

  const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => Array.from(parsedFiles),
    getScriptVersion: fileName => files[fileName] && files[fileName].version.toString(),
    getScriptSnapshot: fileName => {
      if (!fs.existsSync(fileName)) {
        return undefined;
      }
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  ls = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
  return ls;
}

function ensureFileInService(absPath: string) {
  // Initialize if not already
  getOrCreateLanguageService();
  
  // Normalize path format for TS
  const normalizedPath = absPath.replace(/\\/g, '/');
  if (!parsedFiles.has(normalizedPath)) {
    parsedFiles.add(normalizedPath);
  }
  return normalizedPath;
}

// Tool 1: Find References (Blast Radius)
server.tool(
  "find_references",
  "Find references for a symbol in a TypeScript file to calculate blast radius",
  {
    file: z.string().describe("Absolute or relative path to the TypeScript file"),
    line: z.number().describe("1-indexed line number of the symbol"),
    offset: z.number().describe("1-indexed character offset (column) of the symbol")
  },
  async ({ file, line, offset }) => {
    const absPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(absPath)) {
      return { content: [{ type: "text", text: `File not found: ${absPath}` }] };
    }

    const normalizedPath = ensureFileInService(absPath);
    const ls = getOrCreateLanguageService();
    
    const sourceFile = ls.getProgram()?.getSourceFile(normalizedPath);
    if (!sourceFile) {
      return { content: [{ type: "text", text: `Could not parse source file: ${normalizedPath}` }] };
    }

    // Convert 1-indexed line/offset to absolute position
    const position = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, offset - 1);
    
    const references = ls.getReferencesAtPosition(normalizedPath, position);
    if (!references || references.length === 0) {
      return { content: [{ type: "text", text: `No references found.` }] };
    }

    const output = references.map(ref => {
      const refSource = ls.getProgram()?.getSourceFile(ref.fileName);
      if (!refSource) return `${ref.fileName}`;
      const start = ts.getLineAndCharacterOfPosition(refSource, ref.textSpan.start);
      return `${ref.fileName}:${start.line + 1}:${start.character + 1}`;
    }).join('\n');

    return { content: [{ type: "text", text: `References found:\n${output}` }] };
  }
);

// Tool 2: Generate .d.ts on the fly (AST Pruning)
server.tool(
  "generate_dts",
  "Generate .d.ts on the fly for a given TypeScript file using AST pruning",
  {
    file: z.string().describe("Absolute or relative path to the TypeScript file")
  },
  async ({ file }) => {
    const absPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(absPath)) {
      return { content: [{ type: "text", text: `File not found: ${absPath}` }] };
    }

    const normalizedPath = ensureFileInService(absPath);
    const ls = getOrCreateLanguageService();
    const outputFiles = ls.getEmitOutput(normalizedPath, true, true);
    
    if (outputFiles.emitSkipped || outputFiles.outputFiles.length === 0) {
      return { content: [{ type: "text", text: `Could not generate .d.ts for ${normalizedPath}. Ensure it is part of the project.` }] };
    }

    const dtsFiles = outputFiles.outputFiles.filter(f => f.name.endsWith('.d.ts'));
    if (dtsFiles.length === 0) {
      return { content: [{ type: "text", text: `No .d.ts generated for ${normalizedPath}` }] };
    }

    const dtsContent = dtsFiles.map(f => `// ${f.name}\n${f.text}`).join('\n\n');
    return { content: [{ type: "text", text: dtsContent }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("tsserver-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main:", error);
  process.exit(1);
});
