# PWA Component Specification MCP Server

This Model Context Protocol (MCP) server provides access to component specifications for a Progressive Web Application (PWA) component library.

## Overview

The MCP server exposes a set of component specifications as resources and tools, making them accessible to client applications and AI systems. The specifications include:

- Atomic Components: Basic UI components like buttons, typography, etc.
- Widgets: Composite components assembled from atomic components

## Features

- **Resource endpoints** to fetch component specifications
- **Search tools** to find components by name, description, or properties
- **Property inspection** to get detailed information about component properties

## Resources

- `/components/atomic` - Get all atomic components
- `/components/widgets` - Get all widgets
- `/components/widgets/:widgetName` - Get a specific widget by name

## Tools

- `searchComponents` - Search for components by name, description, or properties
- `getComponentProperties` - Get detailed properties of a specific component

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Start the server:
   ```bash
   npm start
   ```

## Development

For development with auto-rebuild:
```bash
npm run dev
```

## Requirements

- Node.js ≥ 20.0.0
- TypeScript 5.8+

## License

ISC 