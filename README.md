# PWA Component Specification MCP Server

This Model Context Protocol (MCP) server provides comprehensive access to the component specifications and associated metadata for a Progressive Web Application (PWA) component library. Its primary goal is to streamline UI development and enable seamless integration with client applications, AI systems, and development tools by offering structured data about the available components.

## Overview

The server acts as a central hub for information about the PWA design system, exposing detailed specifications for atomic components, molecules, and widgets. It allows clients to programmatically explore the component library, understand component properties and relationships, generate configuration templates, and manage widget types.

**Core Capabilities:**

*   **Component Discovery:** Provides tools (`searchComponents`, `getComponentLibrary`, `getWidgetMap`) to find and list components based on various criteria (name, type, category, properties, popularity).
*   **Detailed Inspection:** Allows clients to fetch in-depth information about specific components (`getComponentProperties`), including their properties, required attributes, dependencies (e.g., atomic components used by a molecule), usage context (e.g., which widgets use a specific component), and example JSON configurations (for widgets).
*   **Configuration Generation:** Includes tools to facilitate widget creation by generating base configuration structures (`getWidgetBaseConfig`) complete with starter data based on category and corresponding TypeScript interfaces, and creating specific configuration files (`createWidgetConfig`).
*   **Widget Type Management:** Offers functionality to register new widget types within the system (`addWidgetToMap`).
*   **Theming Information:** Exposes the available CSS custom variables used for theming (`listThemeVariables`), enabling clients to understand customization options.
*   **Resource Access:** Provides direct access to the raw specification files for atomic components and widgets via resource endpoints.

This structured access facilitates tasks like automated code generation, component recommendations, developer assistance, and maintaining consistency across applications using the PWA component library.

## Features

- **Resource endpoints** to fetch component specifications
- **Search tools** to find components by name, description, or properties
- **Property inspection** to get detailed information about component properties

## Resources

- `/components/atomic` - Get all atomic components
- `/components/widgets` - Get all widgets
- `/components/widgets/:widgetName` - Get a specific widget by name

## Tools

- `searchComponents` - Search for components (atomic, molecule, widget) by name, description, properties. Supports fuzzy matching, snippets, and popularity ranking.
- `getComponentProperties` - Get detailed properties, context (usage in other components), and `exampleJson` (for widgets) of a specific component.
- `getWidgetMap` - Retrieves a map of available widgets, optionally filtered by category.
- `createWidgetConfig` - Creates a new widget configuration file based on a specified type and optional layout/header/media/slider details.
- `getWidgetBaseConfig` - Generates a base configuration structure for a new widget, including a starter `widgetData` object based on category and a TypeScript interface definition.
- `addWidgetToMap` - Adds a new widget type constant to the `WidgetMap.ts` file.
- `getComponentLibrary` - Retrieves a comprehensive overview of all atomic components, molecules, and widgets in the library, including summaries and categorized lists.
- `listThemeVariables` - Lists available CSS custom variables used for theming, reading from `component-spec/theme-variables.json`. Supports filtering by type and grouping by prefix.

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