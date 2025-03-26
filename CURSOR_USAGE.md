# Using the PWA Component Specification MCP in Cursor

This guide explains how to use the PWA Component Specification MCP in Cursor for developing UI components.

## Installation

1. Open Cursor
2. Go to Settings > Extensions
3. Click "Install from File/Directory"
4. Select the directory containing this MCP
5. Restart Cursor if prompted

## Using the MCP in Cursor

### Exploring Components

To explore available components:

```
/components/atomic
```

This will list all atomic components with their properties and descriptions.

To explore widgets:

```
/components/widgets
```

### Searching for Components

You can search for components by name, description, or properties:

```
searchComponents(query: "button", type: "atomic")
```

Parameters:
- `query`: Search term
- `type`: "atomic", "widget", or "all"

### Getting Component Properties

To get detailed information about a specific component:

```
getComponentProperties(componentName: "Button", componentType: "atomic")
```

Parameters:
- `componentName`: Name of the component
- `componentType`: "atomic" or "widget"

## Example Workflows

### Finding a Button Component

```
searchComponents(query: "button", type: "atomic")
```

### Exploring Button Properties

```
getComponentProperties(componentName: "Button", componentType: "atomic")
```

### Getting a Specific Widget

```
/components/widgets/media-carousel-widget
```

## Supported Component Categories

- **Atomic Components**: Basic UI elements like buttons, typography, inputs, etc.
- **Widgets**: Complex UI components assembled from atomic components

## Troubleshooting

If you encounter issues using the MCP:

1. Ensure Cursor is updated to the latest version
2. Verify the MCP is properly installed
3. Check the Cursor logs for error messages 