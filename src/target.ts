/**
 * AWS Lambda export target
 *
 * Generates deployment-ready AWS Lambda functions with SAM templates.
 */

import {
  BaseExportTarget,
  type ExportOptions,
  type ExportArtifacts,
  type DeployInstructions,
  type CompiledWorkflow,
  type MultiWorkflowArtifacts,
  type NodeTypeInfo,
  type NodeTypeExportOptions,
  type NodeTypeArtifacts,
  type BundleWorkflow,
  type BundleNodeType,
  type BundleArtifacts,
} from '@synergenius/flow-weaver/deployment';
import { getGeneratedBranding } from '@synergenius/flow-weaver/generated-branding';
import { generateStandaloneRuntimeModule } from '@synergenius/flow-weaver/deployment';

/**
 * Handler template for AWS Lambda (API Gateway v2) - Basic version without docs
 */
const LAMBDA_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
{{WORKFLOW_IMPORT}}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body || '{}')
      : event.body || {};

    const startTime = Date.now();
    const result = await {{FUNCTION_NAME}}(true, body);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
        'X-Request-Id': context.awsRequestId,
      },
      body: JSON.stringify({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId: context.awsRequestId,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: context.awsRequestId,
      }),
    };
  }
};
`;

/**
 * Handler template for AWS Lambda with API documentation routes
 */
const LAMBDA_HANDLER_WITH_DOCS_TEMPLATE = `{{GENERATED_HEADER}}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
{{WORKFLOW_IMPORT}}
import { openApiSpec } from './openapi.js';

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{WORKFLOW_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;
  const path = event.rawPath || event.requestContext?.http?.path || '/';
  const method = event.requestContext?.http?.method || 'GET';

  // Serve OpenAPI spec
  if (path === '/openapi.json' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openApiSpec),
    };
  }

  // Serve Swagger UI
  if (path === '/docs' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: SWAGGER_UI_HTML,
    };
  }

  // Execute workflow
  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body || '{}')
      : event.body || {};

    const startTime = Date.now();
    const result = await {{FUNCTION_NAME}}(true, body);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
        'X-Request-Id': context.awsRequestId,
      },
      body: JSON.stringify({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId: context.awsRequestId,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: context.awsRequestId,
      }),
    };
  }
};
`;

/**
 * OpenAPI spec file template
 */
const OPENAPI_SPEC_TEMPLATE = `// Generated OpenAPI specification
export const openApiSpec = {{OPENAPI_SPEC}};
`;

/**
 * SAM template - Basic version
 */
const SAM_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver workflow - {{WORKFLOW_NAME}}

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256

Resources:
  WorkflowFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: {{WORKFLOW_DESCRIPTION}}
      Events:
        ApiEvent:
          Type: HttpApi
          Properties:
            Path: /{{WORKFLOW_PATH}}
            Method: POST

Outputs:
  ApiEndpoint:
    Description: API endpoint URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/{{WORKFLOW_PATH}}"
`;

/**
 * SAM template with docs routes
 */
const SAM_TEMPLATE_WITH_DOCS = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver workflow - {{WORKFLOW_NAME}}

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256

Resources:
  WorkflowFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: {{WORKFLOW_DESCRIPTION}}
      Events:
        ApiEvent:
          Type: HttpApi
          Properties:
            Path: /{{WORKFLOW_PATH}}
            Method: POST
        DocsEvent:
          Type: HttpApi
          Properties:
            Path: /docs
            Method: GET
        OpenApiEvent:
          Type: HttpApi
          Properties:
            Path: /openapi.json
            Method: GET

Outputs:
  ApiEndpoint:
    Description: API endpoint URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/{{WORKFLOW_PATH}}"
  DocsEndpoint:
    Description: API documentation URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/docs"
`;

/**
 * Multi-workflow handler template for AWS Lambda
 */
const LAMBDA_MULTI_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
{{WORKFLOW_IMPORTS}}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

// Handler type for workflow functions
type WorkflowHandler = (execute: boolean, params: Record<string, unknown>) => unknown;

// Workflow router
const workflows: Record<string, WorkflowHandler> = {
{{WORKFLOW_ENTRIES}}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SERVICE_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;
  const path = event.rawPath || event.requestContext?.http?.path || '/';
  const method = event.requestContext?.http?.method || 'GET';

  // Serve OpenAPI spec
  if (path === '/api/openapi.json' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openApiSpec),
    };
  }

  // Serve Swagger UI
  if (path === '/api/docs' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: SWAGGER_UI_HTML,
    };
  }

  // List available functions
  if (path === '/api/functions' && method === 'GET') {
    const category = event.queryStringParameters?.category;
    const functions = functionRegistry.list(category as any);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(functions),
    };
  }

  // Route to workflow
  const workflowMatch = path.match(/^\\/api\\/([^\\/]+)$/);
  if (!workflowMatch) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  const workflowName = workflowMatch[1];
  const workflow = workflows[workflowName];

  if (!workflow) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: \`Workflow '\${workflowName}' not found\`,
        availableWorkflows: Object.keys(workflows),
      }),
    };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed. Use POST to execute workflows.' }),
    };
  }

  try {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body || '{}')
      : event.body || {};

    const startTime = Date.now();
    const result = await workflow(true, body);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
        'X-Request-Id': context.awsRequestId,
      },
      body: JSON.stringify({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId: context.awsRequestId,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: context.awsRequestId,
      }),
    };
  }
};
`;

/**
 * Node type handler template for AWS Lambda
 */
const LAMBDA_NODE_TYPE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
{{NODE_TYPE_IMPORTS}}
import { openApiSpec } from './openapi.js';

// Handler type for node type functions
type NodeTypeHandler = (execute: boolean, params: Record<string, unknown>) => unknown;

// Node type router
const nodeTypes: Record<string, NodeTypeHandler> = {
{{NODE_TYPE_ENTRIES}}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SERVICE_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;
  const path = event.rawPath || event.requestContext?.http?.path || '/';
  const method = event.requestContext?.http?.method || 'GET';

  // Serve OpenAPI spec
  if (path === '/api/openapi.json' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openApiSpec),
    };
  }

  // Serve Swagger UI
  if (path === '/api/docs' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: SWAGGER_UI_HTML,
    };
  }

  // Route to node type
  const nodeTypeMatch = path.match(/^\\/api\\/([^\\/]+)$/);
  if (!nodeTypeMatch) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  const nodeTypeName = nodeTypeMatch[1];
  const nodeType = nodeTypes[nodeTypeName];

  if (!nodeType) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: \`Node type '\${nodeTypeName}' not found\`,
        availableNodeTypes: Object.keys(nodeTypes),
      }),
    };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed. Use POST to execute node types.' }),
    };
  }

  try {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body || '{}')
      : event.body || {};

    const startTime = Date.now();
    const result = await nodeType(true, body);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
        'X-Request-Id': context.awsRequestId,
      },
      body: JSON.stringify({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId: context.awsRequestId,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: context.awsRequestId,
      }),
    };
  }
};
`;

/**
 * SAM template for node type deployment
 */
const SAM_NODE_TYPE_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver node type service - {{SERVICE_NAME}}

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256

Resources:
  NodeTypeFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: Node type service with {{NODE_TYPE_COUNT}} endpoints
      Events:
        ApiProxy:
          Type: HttpApi
          Properties:
            Path: /api/{proxy+}
            Method: ANY
        ApiDocs:
          Type: HttpApi
          Properties:
            Path: /api/docs
            Method: GET
        ApiOpenapi:
          Type: HttpApi
          Properties:
            Path: /api/openapi.json
            Method: GET

Outputs:
  ApiEndpoint:
    Description: API base URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api"
  DocsEndpoint:
    Description: API documentation URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api/docs"
`;

/**
 * SAM template for multi-workflow deployment
 */
const SAM_MULTI_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver multi-workflow service - {{SERVICE_NAME}}

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256

Resources:
  WorkflowFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: Multi-workflow service with {{WORKFLOW_COUNT}} workflows
      Events:
        ApiProxy:
          Type: HttpApi
          Properties:
            Path: /api/{proxy+}
            Method: ANY
        ApiFunctions:
          Type: HttpApi
          Properties:
            Path: /api/functions
            Method: GET
        ApiDocs:
          Type: HttpApi
          Properties:
            Path: /api/docs
            Method: GET
        ApiOpenapi:
          Type: HttpApi
          Properties:
            Path: /api/openapi.json
            Method: GET

Outputs:
  ApiEndpoint:
    Description: API base URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api"
  DocsEndpoint:
    Description: API documentation URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api/docs"
`;

/**
 * Bundle handler template for AWS Lambda - unified workflows and node types
 */
const LAMBDA_BUNDLE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
{{WORKFLOW_IMPORTS}}
{{NODE_TYPE_IMPORTS}}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

// Handler type for workflow/nodeType functions
type FunctionHandler = (execute: boolean, params: Record<string, unknown>) => unknown;

// Exposed workflows (have HTTP endpoints)
const exposedWorkflows: Record<string, FunctionHandler> = {
{{EXPOSED_WORKFLOW_ENTRIES}}
};

// Exposed node types (have HTTP endpoints)
const exposedNodeTypes: Record<string, FunctionHandler> = {
{{EXPOSED_NODE_TYPE_ENTRIES}}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SERVICE_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;
  const path = event.rawPath || event.requestContext?.http?.path || '/';
  const method = event.requestContext?.http?.method || 'GET';

  // Serve OpenAPI spec
  if (path === '/api/openapi.json' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openApiSpec),
    };
  }

  // Serve Swagger UI
  if (path === '/api/docs' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: SWAGGER_UI_HTML,
    };
  }

  // List available functions
  if (path === '/api/functions' && method === 'GET') {
    const category = event.queryStringParameters?.category;
    const functions = functionRegistry.list(category as any);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(functions),
    };
  }

  // Route to workflow
  const workflowMatch = path.match(/^\\/api\\/workflows\\/([^\\/]+)$/);
  if (workflowMatch) {
    const workflowName = workflowMatch[1];
    const workflow = exposedWorkflows[workflowName];

    if (!workflow) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: \`Workflow '\${workflowName}' not found\`,
          availableWorkflows: Object.keys(exposedWorkflows),
        }),
      };
    }

    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed. Use POST to execute workflows.' }),
      };
    }

    try {
      const body = typeof event.body === 'string'
        ? JSON.parse(event.body || '{}')
        : event.body || {};

      const startTime = Date.now();
      const result = await workflow(true, body);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
          'X-Request-Id': context.awsRequestId,
        },
        body: JSON.stringify({
          success: true,
          result,
          executionTime: Date.now() - startTime,
          requestId: context.awsRequestId,
        }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          requestId: context.awsRequestId,
        }),
      };
    }
  }

  // Route to node type
  const nodeTypeMatch = path.match(/^\\/api\\/nodes\\/([^\\/]+)$/);
  if (nodeTypeMatch) {
    const nodeTypeName = nodeTypeMatch[1];
    const nodeType = exposedNodeTypes[nodeTypeName];

    if (!nodeType) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: \`Node type '\${nodeTypeName}' not found\`,
          availableNodeTypes: Object.keys(exposedNodeTypes),
        }),
      };
    }

    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed. Use POST to execute node types.' }),
      };
    }

    try {
      const body = typeof event.body === 'string'
        ? JSON.parse(event.body || '{}')
        : event.body || {};

      const startTime = Date.now();
      const result = await nodeType(true, body);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
          'X-Request-Id': context.awsRequestId,
        },
        body: JSON.stringify({
          success: true,
          result,
          executionTime: Date.now() - startTime,
          requestId: context.awsRequestId,
        }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          requestId: context.awsRequestId,
        }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not found' }),
  };
};
`;

/**
 * SAM template for bundle deployment
 */
const SAM_BUNDLE_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver bundle service - {{SERVICE_NAME}}

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256

Resources:
  BundleFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: Bundle service with {{WORKFLOW_COUNT}} workflows and {{NODE_TYPE_COUNT}} node types
      Events:
        ApiProxy:
          Type: HttpApi
          Properties:
            Path: /api/{proxy+}
            Method: ANY
        ApiFunctions:
          Type: HttpApi
          Properties:
            Path: /api/functions
            Method: GET
        ApiDocs:
          Type: HttpApi
          Properties:
            Path: /api/docs
            Method: GET
        ApiOpenapi:
          Type: HttpApi
          Properties:
            Path: /api/openapi.json
            Method: GET

Outputs:
  ApiEndpoint:
    Description: API base URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api"
  DocsEndpoint:
    Description: API documentation URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api/docs"
`;

/**
 * AWS Lambda export target
 */
export class LambdaTarget extends BaseExportTarget {
  readonly name = 'lambda';
  readonly description = 'AWS Lambda with SAM (Serverless Application Model)';

  readonly deploySchema = {
    memory: { type: 'number' as const, description: 'Lambda memory in MB', default: 256 },
    runtime: { type: 'string' as const, description: 'Lambda runtime', default: 'nodejs20.x' },
    timeout: { type: 'number' as const, description: 'Function timeout in seconds', default: 30 },
  };

  async generate(options: ExportOptions): Promise<ExportArtifacts> {
    const files = [];
    const includeDocs = options.includeDocs ?? false;

    // Select appropriate handler template
    const handlerTemplate = includeDocs
      ? LAMBDA_HANDLER_WITH_DOCS_TEMPLATE
      : LAMBDA_HANDLER_TEMPLATE;

    // Generate handler
    const handlerContent = handlerTemplate
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target lambda'))
      .replace('{{WORKFLOW_IMPORT}}', `import { ${options.workflowName} } from './workflow.js';`)
      .replace(/\{\{FUNCTION_NAME\}\}/g, options.workflowName)
      .replace(/\{\{WORKFLOW_NAME\}\}/g, options.displayName);

    files.push(this.createFile(options.outputDir, 'handler.ts', handlerContent, 'handler'));

    // Generate OpenAPI spec file if docs are enabled
    if (includeDocs) {
      const openApiSpec = this.generateOpenAPISpec(options);
      const openApiContent = OPENAPI_SPEC_TEMPLATE.replace(
        '{{OPENAPI_SPEC}}',
        JSON.stringify(openApiSpec, null, 2)
      );
      files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));
    }

    // Select appropriate SAM template
    const samTemplate = includeDocs ? SAM_TEMPLATE_WITH_DOCS : SAM_TEMPLATE;

    // Generate SAM template
    const samContent = samTemplate
      .replace(/\{\{WORKFLOW_NAME\}\}/g, options.displayName)
      .replace(
        '{{WORKFLOW_DESCRIPTION}}',
        options.description || `Flow Weaver workflow: ${options.displayName}`
      )
      .replace(/\{\{WORKFLOW_PATH\}\}/g, options.displayName);

    files.push(this.createFile(options.outputDir, 'template.yaml', samContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: options.displayName,
      description: options.description,
      main: 'handler.js',
      scripts: {
        build: 'tsc',
        dev: 'sam build && sam local start-api',
        deploy: 'sam build && sam deploy --guided',
      },
      devDependencies: {
        '@types/aws-lambda': '^8.10.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate README from deploy instructions
    const artifacts: ExportArtifacts = { files, target: this.name, workflowName: options.displayName, entryPoint: 'handler.ts' };
    const instructions = this.getDeployInstructions(artifacts);
    const readme = this.generateReadme(instructions, options.displayName, 'AWS Lambda');
    files.push(this.createFile(options.outputDir, 'README.md', readme, 'other'));

    return artifacts;
  }

  /**
   * Generate OpenAPI specification for the workflow
   */
  private generateOpenAPISpec(options: ExportOptions): object {
    return {
      openapi: '3.0.3',
      info: {
        title: `${options.displayName} API`,
        version: '1.0.0',
        description: options.description || `API for the ${options.displayName} workflow`,
      },
      servers: [{ url: '/', description: 'Current deployment' }],
      paths: {
        [`/${options.displayName}`]: {
          post: {
            operationId: `execute_${options.workflowName}`,
            summary: `Execute ${options.displayName} workflow`,
            description: options.description || `Execute the ${options.displayName} workflow`,
            tags: ['workflows'],
            requestBody: {
              description: 'Workflow input parameters',
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Successful workflow execution',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        result: { type: 'object' },
                        executionTime: { type: 'number' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '500': {
                description: 'Execution error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        error: { type: 'string' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      tags: [{ name: 'workflows', description: 'Workflow execution endpoints' }],
    };
  }

  async generateMultiWorkflow(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts> {
    const files = [];
    const serviceName = options.displayName || 'multi-workflow-service';

    // Generate workflow imports and entries
    const workflowImports = workflows
      .map((w) => `import { ${w.functionName} } from './workflows/${w.name}.js';`)
      .join('\n');

    const workflowEntries = workflows.map((w) => `  '${w.name}': ${w.functionName},`).join('\n');

    // Generate multi-workflow handler
    const handlerContent = LAMBDA_MULTI_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target lambda --multi'))
      .replace('{{WORKFLOW_IMPORTS}}', workflowImports)
      .replace('{{WORKFLOW_ENTRIES}}', workflowEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName);

    files.push(this.createFile(options.outputDir, 'handler.ts', handlerContent, 'handler'));

    // Generate consolidated OpenAPI spec
    const openApiSpec = this.generateConsolidatedOpenAPI(workflows, {
      title: `${serviceName} API`,
      version: '1.0.0',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate SAM template
    const samContent = SAM_MULTI_TEMPLATE.replace(/\{\{SERVICE_NAME\}\}/g, serviceName).replace(
      '{{WORKFLOW_COUNT}}',
      String(workflows.length)
    );

    files.push(this.createFile(options.outputDir, 'template.yaml', samContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: serviceName,
      description: `Multi-workflow service with ${workflows.length} workflows`,
      main: 'handler.js',
      scripts: {
        build: 'tsc',
        deploy: 'sam build && sam deploy --guided',
      },
      devDependencies: {
        '@types/aws-lambda': '^8.10.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate workflow content files
    files.push(...this.generateWorkflowContentFiles(workflows, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      workflowNames: workflows.map((w) => w.name),
      entryPoint: 'handler.ts',
      openApiSpec,
    };
  }

  async generateNodeTypeService(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts> {
    const files = [];
    const serviceName = options.serviceName || 'node-type-service';

    // Generate node type imports and entries
    // Use lowercase functionName for import paths to match the generated file names
    const nodeTypeImports = nodeTypes
      .map((nt) => `import { ${nt.functionName} } from './node-types/${nt.functionName.toLowerCase()}.js';`)
      .join('\n');

    const nodeTypeEntries = nodeTypes.map((nt) => `  '${nt.name}': ${nt.functionName},`).join('\n');

    // Generate node type handler
    const handlerContent = LAMBDA_NODE_TYPE_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target lambda --node-types'))
      .replace('{{NODE_TYPE_IMPORTS}}', nodeTypeImports)
      .replace('{{NODE_TYPE_ENTRIES}}', nodeTypeEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName);

    files.push(this.createFile(options.outputDir, 'handler.ts', handlerContent, 'handler'));

    // Generate OpenAPI spec
    const openApiSpec = this.generateNodeTypeOpenAPI(nodeTypes, {
      title: `${serviceName} API`,
      version: '1.0.0',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate SAM template
    const samContent = SAM_NODE_TYPE_TEMPLATE.replace(/\{\{SERVICE_NAME\}\}/g, serviceName).replace(
      '{{NODE_TYPE_COUNT}}',
      String(nodeTypes.length)
    );

    files.push(this.createFile(options.outputDir, 'template.yaml', samContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: serviceName,
      description: `Node type service with ${nodeTypes.length} endpoints`,
      main: 'handler.js',
      scripts: {
        build: 'tsc',
        deploy: 'sam build && sam deploy --guided',
      },
      devDependencies: {
        '@types/aws-lambda': '^8.10.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate node-type content files
    files.push(...this.generateNodeTypeContentFiles(nodeTypes, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      nodeTypeNames: nodeTypes.map((nt) => nt.name),
      entryPoint: 'handler.ts',
      openApiSpec,
    };
  }

  async generateBundle(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts> {
    const files = [];
    const serviceName = options.displayName || 'bundle-service';

    // Filter to only include items that have generated code
    // Filter to only include items that have generated code
    // Also skip npm imports (names containing '/') as they should be installed via package.json
    const workflowsWithCode = workflows.filter((w) => w.code);
    const nodeTypesWithCode = nodeTypes.filter((nt) => nt.code && !nt.name.includes('/'));

    // Separate exposed and bundled-only items
    const exposedWorkflows = workflows.filter((w) => w.expose);
    const exposedNodeTypes = nodeTypes.filter((nt) => nt.expose);

    // Detect name collisions between workflows and nodeTypes
    const workflowNames = new Set(workflowsWithCode.map((w) => w.functionName));
    const nodeTypeAliases = new Map<string, string>();
    for (const nt of nodeTypesWithCode) {
      if (workflowNames.has(nt.functionName)) {
        nodeTypeAliases.set(nt.functionName, `${nt.functionName}_nodeType`);
      }
    }

    // Generate all workflow imports (both exposed and bundled-only) - only for those with code
    const workflowImports =
      workflowsWithCode.length > 0
        ? workflowsWithCode
            .map((w) => `import { ${w.functionName} } from './workflows/${w.name}.js';`)
            .join('\n')
        : '// No workflows';

    // Generate all node type imports (both exposed and bundled-only) with aliases for collisions - only for those with code
    // Use lowercase functionName for import paths to match the generated file names
    const nodeTypeImports =
      nodeTypesWithCode.length > 0
        ? nodeTypesWithCode
            .map((nt) => {
              const alias = nodeTypeAliases.get(nt.functionName);
              const lowerFunctionName = nt.functionName.toLowerCase();
              if (alias) {
                return `import { ${nt.functionName} as ${alias} } from './node-types/${lowerFunctionName}.js';`;
              }
              return `import { ${nt.functionName} } from './node-types/${lowerFunctionName}.js';`;
            })
            .join('\n')
        : '// No node types';

    // Filter exposed items to only include those with code
    const exposedWorkflowsWithCode = exposedWorkflows.filter((w) => w.code);
    const exposedNodeTypesWithCode = exposedNodeTypes.filter((nt) => nt.code);

    // Generate entries only for exposed items with code
    const exposedWorkflowEntries =
      exposedWorkflowsWithCode.length > 0
        ? exposedWorkflowsWithCode.map((w) => `  '${w.name}': ${w.functionName},`).join('\n')
        : '  // No exposed workflows';

    const exposedNodeTypeEntries =
      exposedNodeTypesWithCode.length > 0
        ? exposedNodeTypesWithCode
            .map((nt) => {
              const alias = nodeTypeAliases.get(nt.functionName);
              return `  '${nt.name}': ${alias || nt.functionName},`;
            })
            .join('\n')
        : '  // No exposed node types';

    // Generate bundle handler
    const handlerContent = LAMBDA_BUNDLE_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target lambda --bundle'))
      .replace('{{WORKFLOW_IMPORTS}}', workflowImports)
      .replace('{{NODE_TYPE_IMPORTS}}', nodeTypeImports)
      .replace('{{EXPOSED_WORKFLOW_ENTRIES}}', exposedWorkflowEntries)
      .replace('{{EXPOSED_NODE_TYPE_ENTRIES}}', exposedNodeTypeEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName);

    files.push(this.createFile(options.outputDir, 'handler.ts', handlerContent, 'handler'));

    // Generate OpenAPI spec for exposed items only
    const openApiSpec = this.generateBundleOpenAPI(workflows, nodeTypes, {
      title: `${serviceName} API`,
      version: '1.0.0',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate SAM template
    const samContent = SAM_BUNDLE_TEMPLATE.replace(/\{\{SERVICE_NAME\}\}/g, serviceName)
      .replace('{{WORKFLOW_COUNT}}', String(workflows.length))
      .replace('{{NODE_TYPE_COUNT}}', String(nodeTypes.length));

    files.push(this.createFile(options.outputDir, 'template.yaml', samContent, 'config'));

    // Collect npm package dependencies from node types (pattern: npm/<package>/<export>)
    const npmDependencies: Record<string, string> = {};
    for (const nt of nodeTypes) {
      if (nt.name.startsWith('npm/')) {
        const rest = nt.name.slice(4);
        let packageName: string;
        if (rest.startsWith('@')) {
          // Scoped package: @scope/package/export
          const segments = rest.split('/');
          packageName = `${segments[0]}/${segments[1]}`;
        } else {
          packageName = rest.split('/')[0];
        }
        npmDependencies[packageName] = '*';
      }
    }

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: serviceName,
      description: `Bundle service with ${workflows.length} workflows and ${nodeTypes.length} node types`,
      main: 'handler.js',
      scripts: {
        build: 'tsc',
        deploy: 'sam build && sam deploy --guided',
      },
      dependencies: Object.keys(npmDependencies).length > 0 ? npmDependencies : undefined,
      devDependencies: {
        '@types/aws-lambda': '^8.10.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate shared runtime types module (workflows import from this)
    const isProduction = options.production ?? true;
    const runtimeTypesContent = generateStandaloneRuntimeModule(isProduction, 'esm');
    files.push(
      this.createFile(options.outputDir, 'runtime/types.ts', runtimeTypesContent, 'other')
    );

    // Generate real runtime files (function registry, builtin functions, parameter resolver)
    files.push(...this.generateRuntimeFiles(options.outputDir, workflows, nodeTypes));

    // Generate workflow and node-type content files
    files.push(...this.generateBundleContentFiles(workflows, nodeTypes, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      workflowNames: workflows.map((w) => w.name),
      nodeTypeNames: nodeTypes.map((nt) => nt.name),
      entryPoint: 'handler.ts',
      openApiSpec,
    };
  }

  getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions {
    const outputDir = artifacts.files[0]?.absolutePath
      ? artifacts.files[0].absolutePath.replace(/\/[^/]+$/, '')
      : '.';

    return {
      title: 'Deploy to AWS Lambda',
      prerequisites: [
        'AWS CLI configured with credentials',
        'AWS SAM CLI installed (https://aws.amazon.com/serverless/sam/)',
      ],
      steps: [
        `cd ${outputDir}`,
        'npm install',
        'npm run build',
        'sam build && sam deploy --guided',
      ],
      localTestSteps: [
        `cd ${outputDir}`,
        'npm install',
        'npm run dev',
        '# API will be available at http://127.0.0.1:3000',
        '# Test with: curl -X POST http://127.0.0.1:3000/{endpoint} -H "Content-Type: application/json" -d \'{"key": "value"}\'',
      ],
      links: [
        {
          label: 'AWS SAM Documentation',
          url: 'https://docs.aws.amazon.com/serverless-application-model/',
        },
        {
          label: 'AWS Lambda Pricing',
          url: 'https://aws.amazon.com/lambda/pricing/',
        },
      ],
    };
  }
}

export default LambdaTarget;
