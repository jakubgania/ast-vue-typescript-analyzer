# ast-vue-typescript-analyzer

This is a working Vue 3 + TypeScript application that demonstrates all the example components analyzed by the  AST Vue TypeScript Analyzer.

## Purpose

This application serves as:

1. **Visual demonstration** - See all analyzed components working in a real app
2. **Type safety validation** - Proves all components compile without TypeScript error
3. **Interactive examples** - Test component functionality and interactions

## What is AST?

**AST (Abstract Syntax Tree)** is a tree representation of the syntactic structure of source code.  
It allows tools to analyze, transform, and understand code by working with its logical structure rather than raw text.

In simple words: 

Code is text. Compilers need structure. AST is that structure. 

**Example**:
```js
const x = 5 + 10;
```
Becomes:
```
VariableDeclaration
└── VariableDeclarator
    ├── Identifier: x
    └── BinaryExpression: +
        ├── Literal: 5
        └── Literal: 10
```

### Why AST Matters
- **ESLint**: Finds anti-patterns by walking the AST
- **Prettier**: Rebuilds code from AST for consistent formatting
- **TypeScript**: Type checks by analyzing AST nodes
- **Webpack**: Understands imports/exports for bundling

## Quick Start

### Install Dependencies

```bash
bun install
# or
npm install
```

### Run Development Server

```bash
bun run dev
# or
nom run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.



## Resources to Link

### Documentation

- [AST Explorer](https://astexplorer.net) - Interactive AST viewer
- [Babel Handbook](https://github.com/jamiebuilds/babel-handbook) - Learn AST manipulation
- [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md)  
- [Babel User Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/user-handbook.md)  
- [Babel types docs](https://babeljs.io/docs/babel-types)
- [Vue Compiler SFC](https://github.com/vuejs/core/tree/main/packages/compiler-sfc) - Vue's compiler sfc
- [Vue Compiler DOM](https://github.com/vuejs/core/tree/main/packages/compiler-dom) - Vue's compiler dom
- [TypeScript AST Viewer](https://ts-ast-viewer.com) - TypeScript-specific AST

### Videos
- [What is an AST?](https://www.youtube.com/watch?v=wINY109MG10)
- [Understanding ASTs](https://www.youtube.com/watch?v=tM_S-pa4xDk)

### Articles
- [Wikipedia: Abstract Syntax Tree](https://en.wikipedia.org/wiki/Abstract_syntax_tree)
- [Wikipedia: Lexical Analysis](https://en.wikipedia.org/wiki/Lexical_analysis)
- [Wikipedia: Parsing](https://en.wikipedia.org/wiki/Parsing)
