import {
  getAllFiles,
  parseExports,
  parseImports,
  extractTagsFromTemplate,
  extractClassesFromStyle,
  analyzeVueFile,
} from "./index.ts";
import * as fs from 'fs/promises';
import path from 'path';
import { parse as vueParse } from '@vue/compiler-sfc';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn
} from "bun:test";

mock.module('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue([]),
  readFile: jest.fn(),
}));

mock.module('@vue/compiler-sfc', () => ({
  parse: jest.fn(),
}));

describe('Project Analyzer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
      console.log("Result - getAllFiles: ", result);
      expect(result).toEqual([
        path.join('/project', 'test.vue'),
        path.join('/project', 'test.ts'),
        path.join('/project', 'index.ts'),
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
        .mockResolvedValueOnce(mockNestedFiles)

      const result = await getAllFiles('/project');
      console.log("Result - getAllFiles: ", result);
      expect(result).toEqual([
        path.join('/project', 'src', 'nested.ts'),
        path.join('/project', 'test.vue'),
      ]);
    });

    it('should handle empty directory', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);
      const result = await getAllFiles('/project');
      expect(result).toEqual([]);
    });
  });

  describe('parseExports', () => {
    it('should parse named function exports', () => {
      const script = `
        export function testFunc() {}
        export const arrowFunc = () => {};
      `;
      const results = parseExports(script);
      console.log("Result - parseExports: ", results);
      expect(results).toEqual({
        functions: ['testFunc', 'arrowFunc'],
        constants: [],
        types: []
      });
    });

    it.skip('should parse default exports', () => {
      const script = `
        export default function defaultFunc() {}
        export default () => {};
      `;
      const result = parseExports(script);
      expect(result).toEqual({
        functions: ['default'],
        constants: [],
        types: [],
      });
    });

    it('should parse type exports', () => {
      const script = `
        export type TestType = string;
        export interface TestInterface {}
      `;
      const result = parseExports(script);
      console.log("Result - parseExports: ", result);
      expect(result).toEqual({
        functions: [],
        constants: [],
        types: ['TestType', 'TestInterface']
      });
    });

    it('should handle parse errors', () => {
      const script = 'invalid syntax !@#$';
      spyOn(console, 'error').mockImplementation(() => {});
      const result = parseExports(script);
      expect(result).toEqual({
        functions: [],
        constants: [],
        types: [],
      });
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('parseImports', () => {
    it('should parse import declarations', () => {
      const script = `
        import { Component } from 'vue';
        import * as utils from './utils';
      `;
      const result = parseImports(script);
      expect(result).toEqual([
        { importedItem: 'Component', source: 'vue' },
        { importedItem: 'utils', source: './utils' },
      ]);
    });

    it('should handle empty imports', () => {
      const script = '';
      const result = parseImports(script);
      expect(result).toEqual([]);
    });

    it('should handle parse errors', () => {
      const script = 'import invalid syntax';
      spyOn(console, 'error').mockImplementation(() => {});
      const result = parseImports(script);
      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('extractTagsFromTemplate', () => {
    it('should extract template tags', () => {
      const template = `
        <div>
          <span class="test">Hello</span>
          <custom-component />
          <example-component></example-component>
        </div>
      `;
      const result = extractTagsFromTemplate(template);
      console.log('Result - extractTagsFromTemplate: ', result);
      expect(result).toEqual(['div', 'span', 'custom-component', 'example-component']);
    });

    it('should handle empty template', () => {
      const result = extractTagsFromTemplate('');
      expect(result).toEqual([]);
    });
  });

  describe('extractClassesFromStyle', () => {
    it('should extract selectors from style block', () => {
      const styleBlocks = [{
        content: `
          .test-class { color: red }
          div, span { margin: 10px }
          .another-class:hover { padding: 5px }
        `
      }];
      const result = extractClassesFromStyle(styleBlocks);
      console.log('Result - extractClassesFromStyle: ', result);
      expect(result).toContainEqual({ type: 'class', name: '.test-class' });
      expect(result).toContainEqual({ type: 'element', name: 'div' });
      expect(result).toContainEqual({ type: 'element', name: 'span' });
      // expect(result).toContainEqual({ type: 'pseudo', name: '.another-class:hover' });
    });

    it('shoudl handle empty style blocks', () => {
      const result = extractClassesFromStyle([]);
      expect(result).toEqual([]);
    });
  });

  describe('analyzeVueFile', () => {
    it('should analyze vue file correctly', async () => {
      const mockContent = 'mock vue content';
      const mockDescriptor = {
        script: { content: 'import { ref } from "vue";' },
        template: { content: '<div><span>Test</span></div>' },
        styles: [{ content: '.test { color: red; }' }]
      };
      (fs.readFile as jest.Mock).mockResolvedValue(mockContent);
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');
      console.log('Result - analyzeVueFile: ', result);
      expect(result).toEqual({
        imports: [{ importedItem: 'ref', source: 'vue' }],
        templateTags: ['div', 'span']
      });
    });

    it('should handle vue file with no script or template', async () => {
      const mockDescriptor = {
        script: null,
        template: null,
        styles: []
      };
      (fs.readFile as jest.Mock).mockRejectedValue('mock content');
      (vueParse as jest.Mock).mockReturnValue({ descriptor: mockDescriptor });

      const result = await analyzeVueFile('/test.vue');
      expect(result).toEqual({
        imports: [],
        templateTags: []
      });
    });

    it('should handle vue file errors', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Read error'));
      spyOn(console, 'error').mockImplementation(() => {});

      const result = await analyzeVueFile('/test.vue');
      expect(result).toEqual({
        imports: [],
        templateTags: []
      });
      expect(console.error).toHaveBeenCalled();
    });
  });
});