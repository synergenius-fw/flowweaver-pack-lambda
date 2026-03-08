# @synergenius/flow-weaver-pack-lambda

AWS Lambda export target for [Flow Weaver](https://github.com/synergenius-fw/flow-weaver).

Generates deployment-ready AWS Lambda functions with SAM templates from Flow Weaver workflows.

## Installation

```bash
npm install @synergenius/flow-weaver-pack-lambda
```

This package is a **marketplace pack** — once installed, Flow Weaver automatically discovers it via `createTargetRegistry()`.

## Usage

### CLI

```bash
# Export a workflow as an AWS Lambda function
npx flow-weaver export my-workflow.ts --target lambda

# With options
npx flow-weaver export my-workflow.ts --target lambda --production --docs
```

### Programmatic

```typescript
import { createTargetRegistry } from '@synergenius/flow-weaver/deployment';

const registry = await createTargetRegistry(process.cwd());
const lambda = registry.get('lambda');

const artifacts = await lambda.generate({
  sourceFile: 'my-workflow.ts',
  workflowName: 'myWorkflow',
  displayName: 'my-workflow',
  outputDir: './dist/lambda',
  production: true,
  includeDocs: true,
});
```

## What it generates

- `handler.ts` — Lambda handler with API Gateway v2 integration
- `template.yaml` — AWS SAM template for deployment
- `package.json` — Dependencies and scripts
- `README.md` — Deployment instructions

Supports single workflow, multi-workflow (router), node type services, and bundle exports.

## Requirements

- `@synergenius/flow-weaver` >= 0.14.0

## License

See [LICENSE](./LICENSE).
