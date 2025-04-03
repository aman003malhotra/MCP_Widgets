# Widget Configuration Generator

A tool to generate standardized widget configuration files based on common patterns found in the component library.

## Features

- Generate JSON schema configurations for widgets with a consistent structure
- Support for various widget types (media, CTA, product grids, sliders)
- CLI interface for interactive widget creation
- Programmatic API for integration into other tools
- Sample React implementation generation

## Installation

No installation is required. The tools are ready to use within this project.

## Usage

### CLI Tool

The CLI tool provides an interactive way to generate widget configurations:

```bash
# Make the script executable (if needed)
chmod +x tools/generate-widget.js

# Run the tool
node tools/generate-widget.js
```

Follow the prompts to create your widget configuration. The tool will ask for:

1. Widget name
2. Widget description
3. Widget category
4. Widget version
5. Optional features (media, CTA, products)
6. Layout options (grid or slider for product widgets)

The generated configuration will be saved to `component-spec/widgets/{widget-name}-widget.json`.

Optionally, you can also save a sample React implementation to `widget-samples/{widget-name}.jsx`.

### Programmatic API

You can also use the widget generator programmatically in your JavaScript code:

```javascript
const { createWidget, generateWidget } = require('./tools/api');

// Generate a widget config without saving to file
const widgetConfig = generateWidget({
  widgetName: 'Product Carousel',
  widgetDescription: 'Displays a carousel of featured products',
  category: 'product',
  version: '1.0.0',
  hasMedia: false,
  hasCta: true,
  hasProducts: true,
  isSlider: true,
  isGrid: false
});

console.log(widgetConfig);

// Create a widget and save it to file
createWidget(
  {
    widgetName: 'Hero Banner',
    widgetDescription: 'A hero banner with call to action',
    hasMedia: true,
    hasCta: true
  },
  './component-spec/widgets',  // Output directory
  true,                        // Save implementation
  './examples'                 // Implementation directory
);
```

## Widget Configuration Structure

The generated widget configurations follow a consistent structure based on the JSON Schema standard:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Widget Name",
  "description": "Widget Description",
  "type": "object",
  "category": "category",
  "version": "1.0.0",
  "allOf": [
    {
      "$ref": "./commonWidgets/common-props.json"
    }
  ],
  "properties": {
    "widgetType": {
      "type": "string",
      "description": "Type of widget for data tracking and analytics",
      "default": "widgetName"
    },
    "widgetId": {
      "type": "string",
      "description": "Widget identifier for tracking and analytics"
    },
    "customClassName": {
      "type": "string",
      "description": "Custom CSS class to apply to the widget"
    },
    "widgetData": {
      "type": "object",
      "description": "Widget-specific data and configuration",
      "properties": {
        // Feature-specific properties go here
      }
    }
  },
  "required": ["widgetData"]
}
```

## Supported Features

The tool generates configurations with support for:

- **Media**: Includes media reference and aspect ratio configuration
- **Call-to-Action**: Button configuration with text, style, and actions
- **Products**: Product listings with reference to the product schema
- **Layouts**:
  - **Grid**: Configurable columns and spacing
  - **Slider**: Configurable slides, autoplay, navigation options

## Customization

You can extend the widget generator to include additional properties by modifying the `generateWidgetConfig` function in `tools/widget-config-generator.js`. 