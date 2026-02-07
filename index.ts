import * as fs from "fs/promises";
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as parseTemplate, type Node as VueNode } from '@vue/compiler-dom';
import { parse as babelParse, type ParserPlugin } from '@babel/parser';
import type { Node } from '@babel/types';
import path from "path";

interface FileAnalysis {
  file: string;
  imports: ImportItem[];
  templateTags: string[];
  exports?: ExportAnalysis;
  props: PropItem[];
  classes: Selector[];
}

interface StyleBlock {
  content: string;
}

interface Selector {
  type: 'class' | 'element' | 'pseudo' | 'other';
  name: string;
}

interface ImportItem {
  importedItem: string;
  source: string;
}

interface PropItem {
  name: string;
  type?: string;
  required?: boolean;
  default?: string;
  description?: string;
}

interface ExportAnalysis {
  functions: string[];
  constants: string[];
  types: string[];
  classes: string[];
}

/**
 * Recursively gets all files with specified extensions from a directory
 * @param dir - Directory to search
 * @param extensions - File extensions to include (e.g., ['.vue', '.ts'])
 * @param ignorePaths - Directory names to ignore (e.g., ['node_modules', 'dist'])
 * @param ignoreFiles - File names to ignore (e.g., ['index.ts'])
 * @returns Array of file paths
 */
export const getAllFiles = async (
  dir: string,
  extensions: string[] = ['.vue', '.ts'],
  igonrePaths: string[] = ['node_modules', 'dist'],
  ignoreFiles: string[] = ['index.ts', 'analyzer.test.ts']
): Promise<string[]> => {
  let results: string[] = [];
  const files = await fs.readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      if (!igonrePaths.includes(file.name)) {
        results = results.concat(
          await getAllFiles(fullPath, extensions, igonrePaths, ignoreFiles)
        );
      }
    } else if (extensions.includes(path.extname(file.name)) && !ignoreFiles.includes(file.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parses export declarations from TypeScript/JavaScript code
 * @param scriptContent - Source code to parse
 * @returns Categorized exports (functions, constants, types, classes)
 */
export const parseExports = (scriptContent: string): ExportAnalysis => {
  try {
    const plugins: ParserPlugin[] = [
      'typescript',
      'jsx',
      ['decorators', { decoratorsBeforeExport: true }],
    ];
    const ast = babelParse(scriptContent, {
      sourceType: 'module',
      plugins,
    });

    const exports: ExportAnalysis = {
      functions: [],
      constants: [],
      types: [],
      classes: [],
    };

    ast.program.body.forEach((node) => {
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        const nodeDeclaration = node.declaration;
        if (nodeDeclaration.type === 'FunctionDeclaration' && nodeDeclaration.id) {
          exports.functions.push(nodeDeclaration.id.name);
        } else if (nodeDeclaration.type === 'VariableDeclaration') {
          nodeDeclaration.declarations.forEach((item) => {
            if (item.id.type === 'Identifier') {
              if (item.init && (item.init.type === 'ArrowFunctionExpression' || item.init.type === 'FunctionExpression')) {
                exports.functions.push(item.id.name);
              } else {
                exports.constants.push(item.id.name);
              }
            }
          });
        } else if ((nodeDeclaration.type === 'TSTypeAliasDeclaration' || nodeDeclaration.type === 'TSInterfaceDeclaration') && nodeDeclaration.id) {
          exports.types.push(nodeDeclaration.id.name);
        } else if (nodeDeclaration.type === 'ClassDeclaration' && nodeDeclaration.id) {
          exports.classes.push(nodeDeclaration.id.name);
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          exports.functions.push(node.declaration.id.name);
        } else if (node.declaration.type === 'Identifier') {
          exports.constants.push(node.declaration.name);
        } else if (
          node.declaration.type === 'ArrowFunctionExpression' || node.declaration.type === 'FunctionExpression'
        ) {
          exports.functions.push('default');
        } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
          exports.classes.push(node.declaration.id.name);
        } else if (node.declaration.type === 'ClassExpression') {
          exports.classes.push('default');
        }
      }
    });

    return exports;
  } catch (error) {
    console.error('❌ Error parsing exports:', (error as Error).message);
    if (process.env.DEBUG) {
      console.error('Stack trace:', error);
    }
    return {
      functions: [],
      constants: [],
      types: [],
      classes: [],
    };
  }
}

/**
 * Parses import declarations from TypeScript/JavaScript code
 * @param scriptContent - Source code to parse
 * @returns Array of import items with their sources
 */
export const parseImports = (scriptContent: string): ImportItem[] => {
  try {
    const plugins: ParserPlugin[] = [
      'typescript',
      'jsx',
      ['decorators', { decoratorsBeforeExport: true }]
    ];
    const ast = babelParse(scriptContent, {
      sourceType: 'module',
      plugins,
    });

    const imports: ImportItem[] = [];
    ast.program.body.forEach((node) => {
      if (node.type === 'ImportDeclaration') {
        node.specifiers.forEach((spec) => {
          imports.push({
            importedItem: spec.local.name,
            source: node.source.value as string,
          });
        });
      }
    });

    return imports;
  } catch (error) {
    console.error('❌ Error parsing imports:', (error as Error).message);
    if (process.env.DEBUG) {
      console.error('Stack trace:', error);
    }
    return [];
  }
}

/**
 * Extracts HTML tags from Vue template
 * @param templateContent - Vue template HTML content
 * @returns Array of unique tag names
 */
export const extractTagsFromTemplate = (templateContent: string): string[] => {
  const tags = new Set<string>();
  const ast = parseTemplate(templateContent);

  const walk = (node: VueNode): void => {
    if ('tag' in node && typeof node.tag === 'string') {
      tags.add(node.tag);
    }
    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  }

  walk(ast);
  return [...tags];
}

/**
 * Extracts CSS selectors from style blocks
 * @param styleBlocks - Array of style blocks from Vue SFC
 * @returns Array of categorized selectors
 */
export const extractClassesFromStyle = (styleBlocks: StyleBlock[]): Selector[] => {
  const selectorSet = new Set<string>();

  styleBlocks.forEach((block) => {
    const lines = block.content.split('\n').map(line => line.trim());

    lines.forEach((line) => {
      const selectorMatch = line.match(/^([^{]+)\s*{/);
      if (selectorMatch && selectorMatch[1]) {
        const selectors = selectorMatch[1].split(',').map(s => s.trim());

        selectors.forEach((selector) => {
          if (selector) {
            const parts = selector.split(/\s+/).filter(part => part);
            parts.forEach((part) => {
              if (part) {
                selectorSet.add(part);
              }
            });
          }
        });
      }
    });
  });

  return [...selectorSet].map((selector) => {
    if (selector.startsWith('.')) {
      return {
        type: 'class',
        name: selector,
      };
    } else if (selector.includes(':')) {
      return {
        type: 'pseudo',
        name: selector,
      };
    } else if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(selector)) {
      return {
        type: 'element',
        name: selector,
      };
    } else {
      return {
        type: 'other',
        name: selector,
      };
    }
  });
}

/**
 * Converts TypeScript AST type nodes to string representation
 * @param node - TypeScript AST node
 * @param scriptContent - Original source code (for slicing when needed)
 * @returns String representation of the type
 */
export const getTypeAnnotation = (node: Node, scriptContent: string): string | undefined => {
  if (!node) return undefined;

  switch (node.type) {
    case 'TSTypeAnnotation':
      return getTypeAnnotation(node.typeAnnotation, scriptContent);
    case 'TSNumberKeyword':
      return 'number';
    case 'TSStringKeyword':
      return 'string';
    case 'TSBooleanKeyword':
      return 'boolean';
    case 'TSVoidKeyword':
      return 'void';
    case 'TSNullKeyword':
      return 'null';
    case 'TSUndefinedKeyword':
      return 'undefined';
    case 'TSAnyKeyword':
      return 'any';
    case 'TSUnknownKeyword':
      return 'unknown';
    case 'TSNeverKeyword':
      return 'never';
    case 'TSObjectKeyword':
      return 'object';
    case 'TSSymbolKeyword':
      return 'symbol';
    case 'TSBigIntKeyword':
      return 'bigint';
    case 'TSArrayType':
      return `${getTypeAnnotation(node.elementType, scriptContent)}[]`;
    case 'TSFunctionType':
      const params = node.parameters
        .map((param) => {
          if (param.type === 'Identifier' && param.typeAnnotation) {
            return `${param.name}: ${getTypeAnnotation(param.typeAnnotation, scriptContent)}`;
          }
          return '';
        })
        .filter(Boolean)
        .join(', ')
      const returnType = getTypeAnnotation(node.typeAnnotation!, scriptContent);
      return `(${params}) => ${returnType}`;
    case 'TSLiteralType':
      if ('value' in node.literal) {
        return JSON.stringify(node.literal.value);
      }
      return scriptContent.slice(node.start!, node.end!);
    case 'TSTypeReference':
      if (node.typeName.type === 'Identifier') {
        const typeName = node.typeName.name;
        if (node.typeParameters) {
          const params = node.typeParameters.params
            .map((param) => getTypeAnnotation(param, scriptContent))
            .join(', ');
          return `${typeName}<${params}>`;
        }
        return typeName;
      }
      return scriptContent.slice(node.start!, node.end!);
    case 'TSUnionType':
      return node.types
        .map((type) => getTypeAnnotation(type, scriptContent))
        .join(' | ');
    case 'TSIntersectionType':
        return node.types
          .map((type) => getTypeAnnotation(type, scriptContent))
          .join(' & ');
    case 'TSTypeLiteral': {
      const members = node.members
        .map((member) => {
          if (member.type === 'TSPropertySignature' && member.key.type === 'Identifier') {
            const type = getTypeAnnotation(member.typeAnnotation!, scriptContent);
            return `${member.key.name}${member.optional ? '?' : ''}: ${type}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('; ');
      return `{ ${members} }`;
    }
    default:
      return scriptContent.slice(node.start!, node.end!);
  }
}

/**
 * Parses props from Vue 3 defineProps calls with TypeScript generics
 * @param scriptContent - Vue script content
 * @returns Array of prop definitions
 */
export const parseProps = (scriptContent: string): PropItem[] => {
  try {
    const plugins: ParserPlugin[] = [
      'typescript',
    ];
    const ast = babelParse(scriptContent, {
      sourceType: 'module',
      plugins,
    });
    const props: PropItem[] = [];

    ast.program.body.forEach((node) => {
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach((decl) => {
          if (
            decl.init &&
            decl.init.type === 'CallExpression' &&
            decl.init.callee.type === 'Identifier' &&
            decl.init.callee.name === 'defineProps'
          ) {
            const typeArg = decl.init.typeParameters?.params[0];
            if (typeArg && typeArg.type === 'TSTypeLiteral') {
              typeArg.members.forEach((member) => {
                if (member.type === 'TSPropertySignature' && member.key.type === 'Identifier') {
                  props.push({
                    name: member.key.name,
                    type: member.typeAnnotation
                      ? getTypeAnnotation(member.typeAnnotation, scriptContent)
                      : undefined,
                    required: !(member.optional ?? false),
                  });
                }
              });
            }
          }
        });
      } else if (node.type === 'ExpressionStatement') {
        const expr = node.expression;
        if (
          expr.type === 'CallExpression' &&
          expr.callee.type === 'Identifier' &&
          expr.callee.name === 'defineProps'
        ) {
          const typeArg = expr.typeParameters?.params[0];
          if (typeArg && typeArg.type === 'TSTypeLiteral') {
            typeArg.members.forEach((member) => {
              if (member.type === 'TSPropertySignature' && member.key.type === 'Identifier') {
                props.push({
                  name: member.key.name,
                  type: member.typeAnnotation
                    ? getTypeAnnotation(member.typeAnnotation, scriptContent)
                    : undefined,
                  required: !(member.optional ?? false),
                });
              }
            });
          }
        }
      }
    });

    return props;
  } catch (error) {
    console.error('❌ Error parsing props:', (error as Error).message);
    if (process.env.DEBUG) {
      console.error('Stack trace:', error);
    }
    return [];
  }
}

/**
 * Analyzes a Vue Single File Component
 * @param filePath - Path to .vue file
 * @returns Analysis data including imports, props, template tags, and style classes
 */
export const analyzeVueFile = async (filePath: string): Promise<{ imports: ImportItem[]; templateTags: string[], props: PropItem[], styleClasses: Selector[] }> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { descriptor } = vueParse(content);
    const scriptContent = descriptor.script?.content || descriptor.scriptSetup?.content || '';
    const templateTags = descriptor.template?.content
      ? extractTagsFromTemplate(descriptor.template.content)
      : [];
    const styleClasses = descriptor.styles.length
      ? extractClassesFromStyle(descriptor.styles)
      : [];
    const imports = scriptContent ? parseImports(scriptContent) : [];
    const props = scriptContent ? parseProps(scriptContent) : [];

    return {
      templateTags,
      imports,
      props,
      styleClasses,
    }
  } catch (error) {
    console.error(`❌ Error analyzing Vue file ${filePath}:`, (error as Error).message);
    if (process.env.DEBUG) {
      console.error('Stack trace:', error);
    }
    return {
      imports: [],
      templateTags: [],
      props: [],
      styleClasses: [],
    };
  }
}

/**
 * Analyzes a TypeScript file
 * @param filePath - Path to .ts file
 * @returns Analysis data including imports and exports
 */
export const analyzeTsFiles = async (filePath: string): Promise<{ imports: ImportItem[]; exports: ExportAnalysis }> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const imports = parseImports(content);
    const exports = parseExports(content);
    return {
      imports,
      exports,
    }
  } catch(error) {
    console.error(`❌ Error analyzing TS file ${filePath}:`, (error as Error).message);
    if (process.env.DEBUG) {
      console.error('Stack trace:', error);
    }
    return {
      imports: [],
      exports: {
        functions: [],
        constants: [],
        types: [],
        classes: [],
      }
    };
  }
}

/**
 * Analyzes all Vue and TypeScript files in a project directory
 * @param projectDir - Root directory to analyze
 * @returns Array of file analyses
 */
const analyzeProject = async (projectDir: string): Promise<FileAnalysis[]> => {
  const files = await getAllFiles(projectDir);
  const result: FileAnalysis[] = [];

  for (const file of files) {
    const fileExtension = path.extname(file);
    let analysis: FileAnalysis = {
      file: path.relative(projectDir, file),
      imports: [],
      templateTags: [],
      props: [],
      classes: []
    };

    if (fileExtension === ".vue") {
      const { imports, templateTags, props, styleClasses } = await analyzeVueFile(file);
      analysis.imports = imports;
      analysis.templateTags = templateTags;
      analysis.props = props;
      analysis.classes = styleClasses;
    }

    if (fileExtension === ".ts") {
      const { imports, exports } = await analyzeTsFiles(file);
      analysis.imports = imports;
      analysis.exports = exports;
    }

    result.push(analysis);
  }

  return result;
}

/**
 * Prints help message for CLI usage
 */
const printHelp = () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         AST Vue TypeScript Analyzer v1.0                   ║
╚════════════════════════════════════════════════════════════╝

Usage:
  bun run index.ts [directory]

Arguments:
  directory    Path to analyze (default: current directory)

Examples:
  bun run index.ts                           # Analyze current directory
  bun run index.ts ./src/components          # Analyze specific directory
  bun run index.ts ~/projects/my-vue-app     # Analyze absolute path

Options:
  --help, -h    Show this help message

Output:
  Results are saved to files-analysis.json

Environment Variables:
  DEBUG=1       Enable detailed error output with stack traces

For more information, visit:
  https://github.com/jakubgania/ast-vue-typescript-analyzer
  `);
}

/**
 * Main entry point
 */
const main = async () => {
  // Check for help flag
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  console.log('🚀 AST Vue TypeScript Analyzer started');
  console.log('');

  // Get project directory from CLI argument or use current directory
  const projectDir = process.argv[2] || process.cwd();
  
  console.log('📁 Project directory:', projectDir);
  console.log('🔍 Analyzing files...');
  console.log('');

  try {
    const analysis = await analyzeProject(projectDir);

    await fs.writeFile('files-analysis.json', JSON.stringify(analysis, null, 2));

    console.log('✅ Analysis complete!');
    console.log('📄 Results saved to files-analysis.json');
    console.log(`📊 Analyzed ${analysis.length} files(s)`);
    console.log('');

    // Print summary
    const vueFiles = analysis.filter(a => a.templateTags.length > 0).length;
    const tsFiles = analysis.filter(a => a.exports).length;

    console.log('Summary:');
    console.log(` - Vue components: ${vueFiles}`);
    console.log(` - TypeScript files: ${tsFiles}`);
    console.log(` - Total imports: ${analysis.reduce((sum, a) => sum + a.imports.length, 0)}`);
    console.log(` - Total props: ${analysis.reduce((sum, a) => sum + a.props.length, 0)}`);

  } catch (error) {
    console.error('');
    console.error('❌ Fatal error:', (error as Error).message);
    if (process.env.DEBUG) {
      console.error('');
      console.error('Stack trace:');
      console.error(error);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
