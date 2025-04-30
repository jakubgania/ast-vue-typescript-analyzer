import * as fs from "fs/promises";
import { parse as vueParse } from '@vue/compiler-sfc';
import { parse as parseTemplate, type Node as VueNode } from '@vue/compiler-dom';
import { parse as babelParse, type ParserPlugin } from '@babel/parser';
// import type { Node } from '@babel/types';
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
    console.error('Error parsing exports:', (error as Error).message);
    return {
      functions: [],
      constants: [],
      types: [],
      classes: [],
    };
  }
}

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
    console.error('Error parsing imports:', (error as Error).message);
    return [];
  }
}

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
                    type: member.typeAnnotation ? scriptContent.slice(member.typeAnnotation.start!, member.typeAnnotation.end!) : undefined,
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
                  type: member.typeAnnotation ? scriptContent.slice(member.typeAnnotation.start!, member.typeAnnotation.end!) : undefined,
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
    console.log('Error parsing props:', (error as Error).message);
    return [];
  }
}

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
    console.error(`Error analyzing Vue file ${filePath}:`, (error as Error).message);
    return {
      imports: [],
      templateTags: [],
      props: [],
      styleClasses: [],
    };
  }
}

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
    console.error(`Error analyzing TS file ${filePath}:`, (error as Error).message);
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

const main = async () => {
  console.log("script start")
  // let projectDir = process.cwd();
  let projectDir = '/Users/jakub/dev/weather-app/src/components/';
  // projectDir = projectDir + '/components';
  console.log("Project dir: ", projectDir);
  console.log("Analyzing files...");
  const analysis = await analyzeProject(projectDir);
  await fs.writeFile('files-analysis.json', JSON.stringify(analysis, null, 2));
  console.log('Results saved to files-analysis.json');
  console.log('Results:', analysis);
}

main().catch(err => console.error("Error:", err));