import {
  getAllFiles,
  parseExports,
  parseImports,
  extractTagsFromTemplate,
  extractClassesFromStyle,
  getTypeAnnotation,
  parseProps,
  analyzeVueFile,
  analyzeTsFiles,
} from "./index.ts";
import * as fs from "fs/promises";
import path from "path";
import { parse as vueParse } from "@vue/compiler-sfc";
import { parse as babelParse } from "@babel/parser";
import type { Node } from "@babel/types";
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn,
} from "bun:test";

mock.module('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue([]),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

mock.module('@vue/compiler-sfc', () => ({
  parse: jest.fn(),
}));

describe('AST Vue TypeScript Analyzer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test Suite: getAllFiles
   * 
   * Purpose:
   * Tests the recursive file discovery functionality that traverses directories
   * to find Vue and TypeScript files for analysis.
   * 
   * Why this is important:
   * - This is the entry point of the analyzer - if file discovery fails,
   *   the entire analysis pipeline stops
   * - Must correctly filter files by extension (.vue, .ts)
   * - Must properly ignore common build/dependncy directories (node_modules, dist)
   *   to avoid analyzing thousands of unnecessary files
   * - Must handle nested directory structures correctly
   * - File system operations are error-prone and need thorough testing
   * 
   * What we're testing:
   * 1. Correct file filtering by extension
   * 2. Recursive directory traversal
   * 3. Proper exclusion of ignored paths
   * 4. Handling of empty directories
   * 5. Custom extension support
   */
  describe('getAllFiles', () => {
    it('should return vue and ts files from directory', async () => {
      const mockFiles = [
        { name: 'test.vue', isDirectory: () => false },
        { name: 'test.ts', isDirectory: () => false },
        { name: 'node_modules', isDirectory: () => true },
        { name: 'test.js', isDirectory: () => false },
        { name: 'index.ts', isDirectory: () => false },
      ];
      (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);

      const result = await getAllFiles('/project');

      expect(result).toEqual([
        path.join('/project', 'test.vue'),
        path.join('/project', 'test.ts'),
      ]);
      expect(fs.readdir).toHaveBeenCalledWith('/project', { withFileTypes: true });
    });

    it('should handle nested directories', async () => {
      const mockFiles = [
        { name: 'src', isDirectory: () => true },
        { name: 'test.vue', isDirectory: () => false },
      ];

      const mockNestedFiles = [
        { name: 'nested.ts', isDirectory: () => false },
      ];

      (fs.readdir as jest.Mock)
        .mockResolvedValueOnce(mockFiles)
        .mockResolvedValueOnce(mockNestedFiles);

      const result = await getAllFiles('/project');

      expect(result).toEqual([
        path.join('/project', 'src', 'nested.ts'),
        path.join('/project', 'test.vue'),
      ]);
    });

    it('should ignore specified directories', async () => {
      const mockFiles = [
        { name: 'node_modules', isDirectory: () => true },
        { name: 'dist', isDirectory: () => true },
        { name: 'src', isDirectory: () => true },
        { name: 'test.vue', isDirectory: () => false },
      ];

      const mockSrcFiles = [
        { name: 'component.vue', isDirectory: () => false },
      ];

      (fs.readdir as jest.Mock)
        .mockResolvedValueOnce(mockFiles)
        .mockResolvedValueOnce(mockSrcFiles);

      const result = await getAllFiles('/project');

      expect(result).toEqual([
        path.join('/project', 'src', 'component.vue'),
        path.join('/project', 'test.vue'),
      ]);
      expect(result).not.toContain(expect.stringContaining('node_modules'));
      expect(result).not.toContain(expect.stringContaining('dist'));
    });

    it('should ignore specified files', async () => {
      const mockFiles = [
        { name: 'index.ts', isDirectory: () => false },
        { name: 'analyzer.test.ts', isDirectory: () => false },
        { name: 'component.ts', isDirectory: () => false },
      ];
      (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);

      const result = await getAllFiles('/project');

      expect(result).toEqual([
        path.join('/project', 'component.ts'),
      ]);
      expect(result).not.toContain(expect.stringContaining('index.ts'));
      expect(result).not.toContain(expect.stringContaining('analyzer.test.ts'));
    });

    it('should handle empty directory', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);
      const result = await getAllFiles('/project');
      expect(result).toEqual([]);
    });

    it('should respect custom extensions', async () => {
      const mockFiles = [
        { name: 'test.vue', isDirectory: () => false },
        { name: 'test.ts', isDirectory: () => false },
        { name: 'test.jsx', isDirectory: () => false },
      ];
      (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);

      const result = await getAllFiles('/project', ['.jsx']);

      expect(result).toEqual([
        path.join('/project', 'test.jsx'),
      ]);
    });
  });

  /**
   * Test Suite: parseExports
   * 
   * Purpose:
   * Tests the ability to extract and categorize all epxorted items from TypeScript/JavaScript code.
   * 
   * Why this is important:
   * - Understanding what a module exports is crucial for dependency analysis
   * - Different export types (functions, constants, types, classes) need different handling
   * - Export analysis helps identify public API surface area
   * - Critical for building dependency graphs and understanding module relationships
   * - Used to generate documentation and API references
   * 
   * What we're testing:
   * 1. Named exports (export function, export const)
   * 2. Default exports (export defualt)
   * 3. Type exports (export type, export interface)
   * 4. Class exports (export class)
   * 5. Distinguishing between functions and constants (arrow functions vs values)
   * 6. Mixed export scenarios
   * 7. Error handling for invalid syntax
   */
  describe('parseExports', () => {
    it('should parse named function exports', () => {
      const script = `
        export function testFunc() {}
        export const arrowFunc = () => {};
      `;
      const results = parseExports(script);

      expect(results).toEqual({
        functions: ['testFunc', 'arrowFunc'],
        constants: [],
        types: [],
        classes: []
      });
    });

    it('should parse default function export', () => {
      const script = `export default function defaultFunc() {}`;
      const result = parseExports(script);

      expect(result.functions).toContain('defaultFunc');
    });

    it('should parse default arrow function export', () => {
      const script = `export default () => {};`;
      const result = parseExports(script);

      expect(result.functions).toContain('default');
    });

    it('should parse type exports', () => {
      const script = `
        export type TestType = string;
        export interface TestInterface {}
      `;
      const result = parseExports(script);

      expect(result).toEqual({
        functions: [],
        constants: [],
        types: ['TestType', 'TestInterface'],
        classes: [],
      });
    });

    it('should parse class exports', () => {
      const script = `
        export class TestClass {}
        export default class DefaultClass {}
      `;
      const result = parseExports(script);

      expect(result.classes).toContain('TestClass');
      expect(result.classes).toContain('DefaultClass');
    });

    it('should parse constant exports', () => {
      const script = `
        export const API_KEY = 'test';
        export const config = { timeout: 5000 };
      `;
      const result = parseExports(script);

      expect(result.constants).toEqual(['API_KEY', 'config']);
    });

    it('should distinguish between function and constant exports', () => {
      const script = `
        export const myFunc = () => {};
        export const myConst = 42;
        export function myFunction() {}
      `;
      const result = parseExports(script);

      expect(result.functions).toEqual(['myFunc', 'myFunction']);
      expect(result.constants).toEqual(['myConst']);
    });

    it('should handle mixed exports', () => {
      const script = `
        export function func() {}
        export const constant = 10;
        export type MyType = string;
        export class MyClass {}
        export interface MyInterface {}
      `;
      const result = parseExports(script);

      expect(result).toEqual({
        functions: ['func'],
        constants: ['constant'],
        types: ['MyType', 'MyInterface'],
        classes: ['MyClass']
      });
    });

    it('should handle parse errors gracefully', () => {
      const script = 'invalid syntax !@#$';
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const result = parseExports(script);

      expect(result).toEqual({
        functions: [],
        constants: [],
        types: [],
        classes: []
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle empty input', () => {
      const result = parseExports('');

      expect(result).toEqual({
        functions: [],
        constants: [],
        types: [],
        classes: []
      });
    });
  });

  /**
   * Test Suite: parseImports
   * 
   * Purpose:
   * Tests the extraction of import statements from TypeScript/JavaScript code.
   * 
   * Why this is important:
   * - Import analysis is fundamental for understanding module dependencies
   * - Helps detect unused imports and circular dependencies
   * - Critical for building dependency graphs
   * - Enable dead code elimination and tree shaking optimizations
   * - Used to track which external libraries and local modules are being used
   * 
   * What we're testing:
   * 1. Named imports (import { x } from 'y')
   * 2. Default imports (import X from 'y')
   * 3. Namespace imports (import * as X from 'y')
   * 4. Mixed import styles (default + named)
   * 5. Import aliases (import { x as y })
   * 6. Error handling for malformed imports
   */
  describe('parseImports', () => {
    it('should parse named imports', () => {
      const script = `
        import { Component } from 'vue';
        import { useState, useEffect } from 'react';
      `;
      const result = parseImports(script);

      expect(result).toEqual([
        { importedItem: 'Component', source: 'vue' },
        { importedItem: 'useState', source: 'react' },
        { importedItem: 'useEffect', source: 'react' },
      ]);
    });

    it('should parse default imports', () => {
      const script = `import React from 'react';`;
      const result = parseImports(script);

      expect(result).toEqual([
        { importedItem: 'React', source: 'react' }
      ]);
    });

    it('should parse namespace imports', () => {
      const script = `import * as utils from './utils';`;
      const result = parseImports(script);

      expect(result).toEqual([
        { importedItem: 'utils', source: './utils' }
      ]);
    });

    it('should parse mixed import styles', () => {
      const script = `
        import React, { useState } from 'react';
        import * as Vue from 'vue';
      `;
      const result = parseImports(script);

      expect(result).toContainEqual({ importedItem: 'React', source: 'react' });
      expect(result).toContainEqual({ importedItem: 'useState', source: 'react' });
      expect(result).toContainEqual({ importedItem: 'Vue', source: 'vue' });
    });

    it('should handle imports with aliases', () => {
      const script = `import { Component as Comp } from 'vue';`;
      const result = parseImports(script);

      expect(result).toEqual([
        { importedItem: 'Comp', source: 'vue' }
      ]);
    });

    it('should handle empty imports', () => {
      const script = '';
      const result = parseImports(script);

      expect(result).toEqual([]);
    });

    it('should handle parse errors gracefully', () => {
      const script = 'import invalid syntax';
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const result = parseImports(script);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  /**
   * Test Suite: extractTagsFromTemplate
   * 
   * Purpose:
   * Test the extraction of HTML/component tags from Vue template sections.
   * 
   * Why this is important:
   * - Helps understand component composition and structure 
   * - Identifies which child components are being used
   * - Can detect unused components
   * - Critical for dependency analysis in Vue applications
   * - Helps validate that all used components are imported
   * - Enables automated documentation of component relationships
   * - Used to build component dependency trees
   * 
   * What we're testing:
   * 1. Basic HTML tags (div, span, p)
   * 2. Custom Vue components (PascalCase and kebab-case)
   * 3. Selc-closing tags
   * 4. Deduplication (same tag used multiple times)
   * 5. Nested component structures
   * 6. Edge cases (empty templates, text-only content)
   */
  describe('extractTagsFromTemplate', () => {
    it('should extract basic HTML tags', () => {
      const template = `
        <div>
          <span class="test">Hello</span>
          <p>World</p>
        </div>
      `;
      const result = extractTagsFromTemplate(template);

      expect(result).toEqual(expect.arrayContaining(['div', 'span', 'p']));
    });

    it('should extract custom component tags', () => {
      const template = `
        <div>
          <custom-component />
          <MyComponent></MyComponent>
        </div>
      `;
      const result = extractTagsFromTemplate(template);

      expect(result).toContain('custom-component');
      expect(result).toContain('MyComponent');
    });

    it('should extract self-closing tags', () => {
      const template = `
        <div>
          <img src="test.jpg" />
          <input type="text" />
        </div>
      `;
      const result = extractTagsFromTemplate(template);

      expect(result).toContain('img');
      expect(result).toContain('input');
    });

    it('should not duplicate tags', () => {
      const template = `
        <div>
          <span>Frist</span>
          <span>Second</span>
          <span>Third</span>
        </div>
      `;
      const result = extractTagsFromTemplate(template);

      const spanCount = result.filter(tag => tag === 'span').length;
      expect(spanCount).toBe(1);
    });

    it('should handle nested components', () => {
      const template = `
        <div>
          <section>
            <article>
              <header>
                <h1>Title</h1>
              </header>
            </article>
          </section>
        </div>
      `;
      const result = extractTagsFromTemplate(template);

      expect(result).toEqual(expect.arrayContaining([
        'div', 'section', 'article', 'header', 'h1'
      ]));
    });

    it('should handle empty template', () => {
      const result = extractTagsFromTemplate('');
      expect(result).toEqual([]);
    });

    it('should handle template with only text', () => {
      const template = 'Just plain text';
      const result = extractTagsFromTemplate(template);

      // Should still return some result (root node)
      expect(Array.isArray(result)).toBe(true);
    });
  });

  /**
   * Test Suite: extractClassesFromStyle
   * 
   * Purpose:
   * Tests the extraction and categorization of CSS selectors from style block.
   * 
   * Why this is important:
   * - Helps identify which CSS clasess are defined in a component
   * - Can cross-reference with template usage to find unused styles
   * - Import for CSS optimization and dead code elimination
   * - Helps detect naming confilcts across components
   * - Enables aoutmated style guide enforcement
   * - Critical for understanding component styling architecture
   * 
   * What we're testing:
   * 1. Class selectors (.class-name)
   * 2. Element selectors (div, span)
   * 3. Pseudo-class selectors (:hover, :visited)
   * 4. Multiple selectors in one rule
   * 5. Descendant selectors (.parent. child)
   * 6. Multiple style block
   * 7. Deduplication of repeated selectors
   */
  describe('extractClassesFromStyle', () => {
    it('should extract class selectors', () => {
      const styleBlocks = [{
        content: `
          .test-class { color: red; }
          .another-class { margin: 10px; }
        `
      }];
      const result = extractClassesFromStyle(styleBlocks);

      expect(result).toContainEqual({ type: 'class', name: '.test-class' });
      expect(result).toContainEqual({ type: 'class', name: '.another-class' });
    });

    it('should extract element selectors', () => {
      const styleBlocks = [{
        content: `
          div { padding: 5px; }
          span { font-size: 14px; }
        `
      }];
      const result = extractClassesFromStyle(styleBlocks);

      expect(result).toContainEqual({ type: 'element', name: 'div' });
      expect(result).toContainEqual({ type: 'element', name: 'span' });
    });

    it('should extract pseudo-class selectors', () => {
      const styleBlocks = [{
        content: `
          .button:hover { background: blue; }
          a:visited { color: purple; }
        `
      }];
      const result = extractClassesFromStyle(styleBlocks);

      // .button:hover is a class selector (starts with .), not pseudo
      expect(result).toContainEqual({ type: 'class', name: '.button:hover' });
      // a:visited an element with pseudo-class
      expect(result).toContainEqual({ type: 'pseudo', name: 'a:visited' });
    });

    it('should handle multiple selectors on one line', () => {
      const styleBlocks = [{
        content: `div, span, p { margin: 0; }`
      }];
      const result = extractClassesFromStyle(styleBlocks);

      expect(result).toContainEqual({ type: 'element', name: 'div' });
      expect(result).toContainEqual({ type: 'element', name: 'span' });
      expect(result).toContainEqual({ type: 'element', name: 'p' });
    });

    it('should handle descendant selectors', () => {
      const styleBlocks = [{
        content: `.container .item { padding: 10px; }`
      }];
      const result = extractClassesFromStyle(styleBlocks);

      expect(result).toContainEqual({ type: 'class', name: '.container' });
      expect(result).toContainEqual({ type: 'class', name: '.item' });
    });

    it('should handle multiple style blocks', () => {
      const styleBlocks = [
        { content: `.class-one { color: red; }` },
        { content: `.class-two { color: blue; }` }
      ];
      const result = extractClassesFromStyle(styleBlocks);

      expect(result).toContainEqual({ type: 'class', name: '.class-one' });
      expect(result).toContainEqual({ type: 'class', name: '.class-two' });
    });

    it('should handle empty style blocks', () => {
      const result = extractClassesFromStyle([]);
      expect(result).toEqual([]);
    });

    it('should not duplicate selectors', () => {
      const styleBlocks = [{
        content: `
          .test { color: red; }
          .test { margin: 10px }
        `
      }];
      const result = extractClassesFromStyle(styleBlocks);

      const testCount = result.filter(s => s.name === '.test').length;
      expect(testCount).toBe(1);
    });
  });

  /**
   * Test Suite: getTypeAnnotation
   * 
   * Purpose:
   * Tests the conversion of TypeScript AST type nodes into redable string representations.
   * 
   * Whe this is important:
   * - This is the MOST COMPLEX function in the analyzer
   * - TypeScript has dozens of different type constructs (primitives, unions, generics, etc.)
   * - Accurate type extraction is critical for prop analysis and documentation
   * - Type information is what makes TypeScript valuable - we need to preserve it
   * - Used extensively by parse Props to show developers what types their components accept
   * - Errors here would result in incorrect or missing type information in analysis output
   * - Must handle nrested types, generics, unions, intersections and complex object literals
   * 
   * What we're testing:
   * 1. All TypeScript primitive types (string, number, boolean, null, undefined, etc.)
   * 2. Array types (T[], Array<T>)
   * 3. Union types (A | B | C)
   * 4. Intersections types (A & B)
   * 5. Generic types (Promise<T>, Array<User>)
   * 6. Nested generics (Promise<Array<string>>)
   * 7. Object literal types ({ name: string })
   * 8. Optional properties in objects ({ name?: string })
   * 9. Literal types ('success', 42, true)
   */
  describe('getTypeAnnotation', () => {
    const createTypeNode = (code: string): Node | null => {
      const ast = babelParse(`const x: ${code} = null`, {
        sourceType: 'module',
        plugins: ['typescript'],
      });
      const declaration = ast.program.body[0];
      if (declaration?.type === 'VariableDeclaration') {
        const declarator = declaration.declarations[0];
        if (declarator?.id.type === 'Identifier' && declarator.id.typeAnnotation) {
          // Type guard to ensure we have TSTypeAnnotation
          if (declarator.id.typeAnnotation.type === 'TSTypeAnnotation') {
            return declarator.id.typeAnnotation.typeAnnotation;
          }
        }
      }
      return null;
    };

    it('should handle primitive types', () => {
      const testCases = [
        { code: 'string', expected: 'string' },
        { code: 'number', expected: 'number' },
        { code: 'boolean', expected: 'boolean'},
        { code: 'null', expected: 'null' },
        { code: 'undefined', expected: 'undefined' },
        { code: 'any', expected: 'any' },
        { code: 'unknown', expected: 'unknown' },
        { code: 'never', expected: 'never' },
        { code: 'void', expected: 'void' },
      ];

      testCases.forEach(({ code, expected }) => {
        const node = createTypeNode(code);
        const result = getTypeAnnotation(node!, `const x: ${code} = null`);
        expect(result).toBe(expected);
      });
    });

    it('should handle array types', () => {
      const node = createTypeNode('string[]');
      const result = getTypeAnnotation(node!, 'const x: string[] = null');
      expect(result).toBe('string[]');
    });

    it('should handle union types', () => {
      const code = "'primary' | 'secondary' | 'danger'";
      const node = createTypeNode(code);
      const result = getTypeAnnotation(node!, `const x: ${code} = null`);
      expect(result).toContain('|');
      expect(result).toContain('primary');
      expect(result).toContain('secondary');
      expect(result).toContain('danger');
    });

    it('should handle generic types', () => {
      const code = 'Array<string>';
      const node = createTypeNode(code);
      const result = getTypeAnnotation(node!, `const x: ${code} = null`);
      expect(result).toBe('Array<string>');
    });

    it('should handle nested generic types', () => {
      const code = 'Promise<Array<string>>';
      const node = createTypeNode(code);
      const result = getTypeAnnotation(node!, `const x: ${code} = null`);
      expect(result).toBe('Promise<Array<string>>');
    });

    it('should handle object literal types', () => {
      const code = '{ name: string; age: number }';
      const node = createTypeNode(code);
      const result = getTypeAnnotation(node!, `const x: ${code} = null`);
      expect(result).toContain('name');
      expect(result).toContain('string');
      expect(result).toContain('age');
      expect(result).toContain('number');
    });

    it('should handle optional properties', () => {
      const code = '{ name: string; age?: number }';
      const node = createTypeNode(code);
      const result = getTypeAnnotation(node!, `const x: ${code} = null`);
      expect(result).toContain('age?');
    });

    it('should handle literal types', () => {
      const code = '"success"';
      const node = createTypeNode(code);
      const result = getTypeAnnotation(node!, `const x: ${code} = null`);
      expect(result).toContain('success');
    });
  });

  /**
   * Test Suite: parseProps
   * 
   * Purpose:
   * Tests the extraction of Vue component props with their TypeScript types.
   * 
   * Why this is important: 
   * - Props are the PRIMARY interface of Vue components
   * - Understanding props is essential for component documentation
   * - Type-safe props are a key benefit of using TypeScript with Vue
   * - This information is used to generate prop tables in documentation
   * - Helps developers understand how to use components correctly
   * - Critical for API documentation and component libraries
   * - Must handle Vue 3's defineProps<T>() syntax with TypeScript generics
   * 
   * What we're testing: 
   * 1. Simple primitive prop types (string, number, boolean)
   * 2. Optional vs required props (with ? operator)
   * 3. Union types for props ('primary' | 'secondary')
   * 4. Array type props (string[], Array<T>)
   * 5. Generic type props (Promise<User>, Array<Item>)
   * 6. Object literal type props ({ config: { timeout: number } })
   * 7. Function type props ((data: string) => void)
   * 8. Different defineProps patterns (const props = defineProps vs standalone)
   * 9. Error handling for malformed syntax
   */
  describe('parseProps', () => {
    it('should parse defineProps with simple types', () => {
      const script = `
        defineProps<{
          name: string;
          age: number;
          active: boolean;
        }>();
      `;
      const result = parseProps(script);

      expect(result).toContainEqual({
        name: 'name',
        type: 'string',
        required: true
      });
      expect(result).toContainEqual({
        name: 'age',
        type: 'number',
        required: true
      });
      expect(result).toContainEqual({
        name: 'active',
        type: 'boolean',
        required: true,
      });
    });

    it('should parse optional props', () => {
      const script = `
        defineProps<{
          name: string;
          nickname?: string;
        }>();
      `;
      const result = parseProps(script);

      expect(result).toContainEqual({
        name: 'name',
        type: 'string',
        required: true
      });
      expect(result).toContainEqual({
        name: 'nickname',
        type: 'string',
        required: false
      });
    });

    it('should parse array type props', () => {
      const script = `
        defineProps<{
          items: string[];
          numbers: number[]; 
        }>();
      `;

      const result = parseProps(script);

      expect(result).toContainEqual({
        name: 'items',
        type: 'string[]',
        required: true
      });
      expect(result).toContainEqual({
        name: 'numbers',
        type: 'number[]',
        required: true
      });
    });

    it('should parse object literal type props', () => {
      const script = `
        defineProps<{
          config: { timeout: number; retry: boolean };
        }>();
      `;
      const result = parseProps(script);

      expect(result[0]?.name).toBe('config');
      expect(result[0]?.type).toContain('timeout');
      expect(result[0]?.type).toContain('number');
      expect(result[0]?.type).toContain('retry');
      expect(result[0]?.type).toContain('boolean');
    });

    it('should handle defineProps in variable declaration', () => {
      const script = `
        const props = defineProps<{
          title: string;
        }>();
      `;
      const result = parseProps(script);

      expect(result).toContainEqual({
        name: 'title',
        type: 'string',
        required: true
      });
    });

    it('should handle empty defineProps', () => {
      const script = `defineProps<{}>();`;
      const result = parseProps(script);

      expect(result).toEqual([]);
    });

    it('should handle complex nested types', () => {
      const script = `
        defineProps<{
          callback: (data: string) => void;
          handler?: (event: MouseEvent) => Promise<void>;
        }>();
      `;
      const result = parseProps(script);

      expect(result[0]?.name).toBe('callback');
      expect(result[0]?.type).toContain('=>');
      expect(result[1]?.name).toBe('handler');
      expect(result[1]?.required).toBe(false);
    });
  });

  /**
   * Test Suite: analyzeVueFile
   * 
   * Purpose:
   * Tests the complete analysis of Vue Signle File Components (.vue files).
   * 
   * Why this is important:
   * - This is the MAIN INTEGRATION POINT for Vue file analysis
   * - Combines all other parsing functions (imports, props, templates, styles)
   * - Must correctly parse the SFC structure (template/script/style sections)
   * - Handles both <script> and <script setup> syntax
   * - Critical for the end-to-end analysis workflow
   * - Demonstrates that all individual parsers work together correctly
   * - Real-world usage depend on this function working realibly
   * 
   * What we're testing:
   * 1. Complete Vue file with all sections
   * 2. <script> vs <script setup> handling
   * 3. Files with missing sections (no template, no script)
   * 4. File read errors
   * 5. Multiple style blocks
   * 6. Integration of all parsing results
   */
  describe('analyzeVueFile', () => {
    it('should analyze complete Vue file', async () => {
      const mockContent = `
        <template>
          <div class="container">
            <h1>{{ title }}</h1>
          </div>
        </template>
        <script setup lang="ts">
        import { ref } from 'vue';
        defineProps<{ title: string }>();
        </script>
        <style scoped>
        .container { padding: 20px; }
        </style>
      `;
      const mockDescriptor = {
        script: null,
        scriptSetup: { content: `import { ref } from 'vue';\ndefineProps<{ title: string }>();` },
        template: { content: '<div class="container"><h1>{{ title }}</h1></div>' },
        styles: [{ content: '.container { padding: 20px; }' }]
      };

      (fs.readFile as jest.Mock).mockResolvedValue(mockContent);
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');

      expect(result.imports).toContainEqual({ importedItem: 'ref', source: 'vue' });
      expect(result.templateTags).toContain('div');
      expect(result.templateTags).toContain('h1');
      expect(result.props.length).toBeGreaterThan(0);
      expect(result.styleClasses).toContainEqual({ type: 'class', name: '.container' });
    });

    it('should handle Vue file with script (not setup)', async () => {
      const mockDescriptor = {
        script: { content: 'import { defineComponent } from "vue";' },
        scriptSetup: null,
        template: { content: '<div>Test</div>' },
        styles: []
      };

      (fs.readFile as jest.Mock).mockResolvedValueOnce('mock content');
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');

      expect(result.imports).toContainEqual({ importedItem: 'defineComponent', source: 'vue' });
    });

    it('should handle Vue file with no script', async () => {
      const mockDescriptor = {
        script: null,
        scriptSetup: null,
        template: { content: '<div>Staitc</div>' },
        styles: []
      };

      (fs.readFile as jest.Mock).mockResolvedValue('mock content');
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');
      
      expect(result.imports).toEqual([]);
      expect(result.props).toEqual([]);
      expect(result.templateTags).toContain('div');
    });

    it('should handle Vue file with no template', async () => {
      const mockDescriptor = {
        script: { content: 'export default {}' },
        scriptSetup: null,
        template: null,
        styles: []
      };

      (fs.readFile as jest.Mock).mockResolvedValue('mock content');
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');
      
      expect(result.templateTags).toEqual([]);
    });

    it('should handle file read errors', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
      
      const result = await analyzeVueFile('/nonexistent.vue');

      expect(result).toEqual({
        imports: [],
        templateTags: [],
        props: [],
        styleClasses: []
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle multiple style block', async () => {
      const mockDescriptor = {
        script: null,
        scriptSetup: null,
        template: { content: '<div>Test</div>' },
        styles: [
          { content: '.class-one { color: red; }' },
          { content: '.class-two { color: blue;}' },
        ]
      };

      (fs.readFile as jest.Mock).mockResolvedValue('mock content');
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');

      expect(result.styleClasses.length).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * Test Sutie: analyzeTsFiles
   * 
   * Purpose:
   * Tests the analysis of standalone TypeScript files (not Vue SFCs).
   * 
   * Whi this is important:
   * - TypeScript utility files, types and helpers are crucial parts of projects
   * - Need to analyze both Vue components AND supporting TypeScript files
   * - Type definitions and interfaces are often in separate. .ts files
   * - Helps understand the complete project structure, not just components
   * - Critical for building complete dependency graphs
   * - Identifies reusable utilities and shared types
   * 
   * What we're testing:
   * 1. Basic TypeScript file analysis
   * 2. Files with type definitions
   * 3. Files with classes
   * 4. File read errors
   * 5. Empty files 
   * 6. Mixed content (functions, types, classes, constants)
   */
  describe('analyzeTsFiles', () => {
    it('should analyze TypeScript file', async () => {
      const mockContent = `
        import { helper } from './helper';

        export function processData() {
          return helper();
        }

        export const API_URL = 'https://api.example.com';
      `;
      (fs.readFile as jest.Mock).mockResolvedValue(mockContent);

      const result = await analyzeTsFiles('/test.ts');

      expect(result.imports).toContainEqual({ importedItem: 'helper', source: './helper' });
      expect(result.exports.functions).toContain('processData');
      expect(result.exports.constants).toContain('API_URL');
    });

    it('should handle TypeScript with types', async () => {
      const mockContent = `
        export type UserId = string;
        export interface User {
          id: UserId;
          name: string;
        }
      `;
      (fs.readFile as jest.Mock).mockResolvedValue(mockContent);
      
      const result = await analyzeTsFiles('/types.ts');

      expect(result.exports.types).toContain('UserId');
      expect(result.exports.types).toContain('User');
    });

    it('should handle TypeScript with clasess', async () => {
      const mockContent = `
        export class UserService {
          getUser(id: string) {
            return null;
          }
        }
      `;

      (fs.readFile as jest.Mock).mockResolvedValue(mockContent);
      
      const result = await analyzeTsFiles('/service.ts');

      expect(result.exports.classes).toContain('UserService');
    });

    it('should handle file read errors', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const result = await analyzeTsFiles('/restricted.ts');

      expect(result).toEqual({
        imports: [],
        exports: {
          functions: [],
          constants: [],
          types: [],
          classes: []
        }
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle empty TypeScript file', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('');

      const result = await analyzeTsFiles('/empty.ts');

      expect(result.imports).toEqual([]);
      expect(result.exports).toEqual({
        functions: [],
        constants: [],
        types: [],
        classes: []
      });
    });

    it('should handle mixed exports in TypeScript', async () => {
      const mockContent = `
        import { Config } from './config';

        export type Status = 'active' | 'inactive';
        export interface Settings extends Config {
          theme: string;
        }
        export class Manager {}
        export function initialize() {}
        export const VERSION = '1.0.0';
      `;
      (fs.readFile as jest.Mock).mockResolvedValue(mockContent);

      const result = await analyzeTsFiles('/module.ts');

      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.exports.types.length).toBeGreaterThan(0);
      expect(result.exports.classes.length).toBeGreaterThan(0);
      expect(result.exports.functions.length).toBeGreaterThan(0);
      expect(result.exports.constants.length).toBeGreaterThan(0);
    });

    /**
     * Test Suite: Integration Tests
     * 
     * Purpose:
     * Tests that all analyzer functions work correctly together on realistic,
     * complex Vue components.
     * 
     * Why this is important:
     * - Individual unit tests verify isolated functionality
     * - Integration tests verify the ENTIRE SYSTEM works end-to-end
     * - Real components are complex with multiple interacting features
     * - Ensures that combining multiple parsing operations doesn't cause issues
     * - Validates realistic use cases taht user will actually encounter
     * - Catches bugs taht only appear when features interact
     * - Provides confidence taht the analyzer works on production code
     * 
     * What we're testing:
     * 1. A complex component with ALL features:
     *    - Multiple imports (Vue, custom types)
     *    - Complex props (optional, unions, generics)
     *    - Rich templates (multiple tags, directives, slots)
     *    - Multiple style classes
     *    - Emit definitions
     *    - Computed properties
     * 2. Verification that ALL parsing functions produce correct output
     * 3. Realistic component structure that mirrors production code
     */
  })
})