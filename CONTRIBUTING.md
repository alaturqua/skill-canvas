# Contributing to Skill Canvas

Thanks for your interest in contributing to Skill Canvas.

We welcome bug reports, feature ideas, documentation improvements, and pull requests.

## Development setup

1. Fork the repository and clone your fork.
2. Install dependencies:

```sh
npm install
```

3. Run the project checks:

```sh
npm run compile
npm test
npm run lint
```

## Workflow

- Create a feature branch from `main`.
- Keep changes focused and easy to review.
- Prefer small pull requests over large ones.
- Update documentation when behavior changes.

## Commit guidance

- Use clear, descriptive commit messages.
- Keep commits small and related to a single concern.

## Pull requests

Before opening a PR:

- make sure the project compiles
- run the test suite
- check formatting and linting
- include a clear explanation of what changed and why

Please describe:

- the problem being solved
- the change made
- any follow-up work or limitations

## Reporting bugs

When reporting a bug, include:

- what you expected to happen
- what actually happened
- steps to reproduce
- your VS Code version
- your OS
- whether the issue is reproducible in the sandbox example

## Code of conduct

Please be respectful and constructive in discussions and pull requests.

## Release process

Releases are handled via GitHub Actions and version tags. If you are helping with release work, follow the repository's existing workflow and ensure the version and tag match before publishing.
