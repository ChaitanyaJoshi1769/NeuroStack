# Contributing to NeuroStack

Thank you for your interest in contributing to NeuroStack! This document provides guidelines and instructions for contributing.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and professional in all interactions.

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Python 3.11+ (for API)
- Rust 1.74+ (for query runtime)
- Git

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/ChaitanyaJoshi1769/NeuroStack.git
cd NeuroStack

# Install dependencies
npm install

# Start local environment
docker-compose up -d

# Build packages
npm run build
```

## Development Workflow

### 1. Create a Branch

```bash
# Update main branch
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name
```

### 2. Make Changes

- Follow the coding standards below
- Keep commits atomic and well-documented
- Add tests for new features

### 3. Validate Your Changes

```bash
# Format code
npm run format

# Run linter
npm run lint

# Type check
npm run type-check

# Run tests
npm run test

# Build packages
npm run build
```

### 4. Commit and Push

```bash
git add .
git commit -m "feat: add new feature description"
git push origin feature/your-feature-name
```

### 5. Create Pull Request

- Describe the changes clearly
- Reference any related issues
- Ensure CI passes

## Coding Standards

### TypeScript

- Use strict mode (`"strict": true`)
- No `any` types - use proper types
- Export all public APIs from index files
- Document public functions with JSDoc comments

### File Organization

```typescript
// 1. Imports
import { type SomeType, SomeClass } from '@neurostack/package';

// 2. Type definitions
export interface MyInterface {
  // ...
}

// 3. Class/function implementations
export class MyClass {
  // ...
}

// 4. Exports
export { MyClass };
```

### Naming Conventions

- **Files**: kebab-case (e.g., `my-file.ts`)
- **Classes**: PascalCase (e.g., `MyClass`)
- **Functions**: camelCase (e.g., `myFunction`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MY_CONSTANT`)
- **Interfaces**: PascalCase prefixed with `I` (e.g., `IMyInterface`) or just `PascalCase` (e.g., `MyInterface`)

### Comments

- Comment the "why", not the "what"
- Use JSDoc for public APIs
- Keep comments up-to-date

```typescript
// Good
/// Retry a function with exponential backoff
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3
): Promise<T> {
  // Implementation
}

// Bad
// This function retries
export async function retry<T>(fn: () => Promise<T>) {
  // Implementation
}
```

## Testing

### Write Tests For

- New features
- Bug fixes
- Public APIs
- Complex logic

### Test Structure

```typescript
describe('MyClass', () => {
  describe('myMethod', () => {
    it('should return expected value', () => {
      const result = new MyClass().myMethod();
      expect(result).toEqual('expected');
    });
  });
});
```

## Documentation

### Update Documentation When

- Adding new features
- Changing APIs
- Fixing bugs that required clarification
- Improving clarity

### Documentation Files

- **README.md** - Project overview
- **ARCHITECTURE.md** - System design
- **docs/** - Detailed guides
- **JSDoc comments** - Code-level docs

## Commit Messages

Follow conventional commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding/updating tests
- `chore`: Dependency updates, etc.

### Examples

```
feat(semantic-engine): add metric resolution

Implement metric resolution using Levenshtein distance
similarity scoring. Add tests for edge cases.

Fixes #123
```

```
fix(vector-runtime): correct cosine similarity calculation

The cosine similarity was inverting the result. Now returns
value between 0-1 where 1 is most similar.
```

## Pull Request Guidelines

### Before Submitting

- [ ] Code follows project standards
- [ ] All tests pass
- [ ] Documentation is updated
- [ ] No breaking changes without discussion
- [ ] Commit history is clean

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] New feature
- [ ] Bug fix
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Closes #123

## Testing
How was this tested?

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No console warnings
```

## Areas for Contribution

### High Priority

- [ ] Complete Phase 1 implementations
- [ ] Query optimization
- [ ] Vector search enhancements
- [ ] Agent framework improvements
- [ ] Documentation

### Medium Priority

- [ ] UI component library
- [ ] Additional agent types
- [ ] Performance optimization
- [ ] Security enhancements

### Nice-to-Have

- [ ] Example datasets
- [ ] Integration guides
- [ ] Deployment guides
- [ ] Tutorial videos

## Getting Help

- **GitHub Issues** - Report bugs or request features
- **Discussions** - Ask questions and discuss ideas
- **Documentation** - Check [docs/](./docs/) for detailed guides
- **Architecture** - See [ARCHITECTURE.md](./ARCHITECTURE.md)

## Review Process

1. **Automated Checks** - CI/CD must pass
2. **Code Review** - At least one approval
3. **Testing** - Manual testing if needed
4. **Merge** - Squash and merge to main

## Release Process

Releases follow semantic versioning (MAJOR.MINOR.PATCH)

- Version bump in package.json
- Update CHANGELOG.md
- Create GitHub release
- Tag commit

## Questions?

Feel free to reach out:
- Open a GitHub Issue
- Start a Discussion
- Email: chaitanyajoshi15@gmail.com

Thank you for contributing to NeuroStack! 🚀
