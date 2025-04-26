import { getAllFiles, parseExports } from "./index.ts";
import * as fs from 'fs/promises';
import path from 'path';
import { beforeEach, describe, expect, it, jest, mock } from "bun:test";

mock.module('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue([])
}))

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
  })
});