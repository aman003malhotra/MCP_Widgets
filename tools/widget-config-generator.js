/**
 * Widget Config Generator Tool
 * 
 * This tool generates a basic configuration structure for widgets based on common patterns.
 * It provides a standardized template that can be customized for specific widget types.
 */

export function generateWidgetConfig(options) {
  const {
    widgetName = 'Custom Widget',
    widgetDescription = 'A custom widget component',
    category = 'custom',
    version = '1.0.0',
    hasMedia = false,
    hasCta = false,
    hasProducts = false,
    additionalProps = {},
    isSlider = false,
    isGrid = false,
  } = options;

  // Convert widget name to kebab case for the file name
  const kebabCaseName = widgetName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  
  // Convert widget name to camel case for type
  const camelCaseName = kebabCaseName
    .split('-')
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  // Base widget structure
  const widgetConfig = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": widgetName,
    "description": widgetDescription,
    "type": "object",
    "category": category,
    "version": version,
    "allOf": [
      {
        "$ref": "./commonWidgets/common-props.json"
      }
    ],
    "properties": {
      "widgetType": {
        "type": "string",
        "description": "Type of widget for data tracking and analytics",
        "default": camelCaseName
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
        "properties": {}
      }
    },
    "required": ["widgetData"]
  };

  // Add properties based on widget features
  const widgetDataProps = widgetConfig.properties.widgetData.properties;

  // Add media-related properties if needed
  if (hasMedia) {
    widgetDataProps.media = {
      "$ref": "./commonWidgets/media.json",
      "description": "Media configuration for the widget"
    };
    
    widgetDataProps.aspectRatio = {
      "type": "number",
      "description": "Aspect ratio for the media content",
      "default": 1
    };
    
    // Add to required properties
    if (!widgetConfig.properties.widgetData.required) {
      widgetConfig.properties.widgetData.required = [];
    }
    widgetConfig.properties.widgetData.required.push("media");
  }

  // Add CTA properties if needed
  if (hasCta) {
    widgetDataProps.cta = {
      "type": "object",
      "description": "Call-to-action button configuration",
      "properties": {
        "label": {
          "type": "string",
          "description": "Text label for the CTA button"
        },
        "variant": {
          "type": "string",
          "description": "Visual style of the button",
          "enum": [
            "PRIMARY",
            "SECONDARY",
            "TERTIARY",
            "GHOST"
          ]
        },
        "size": {
          "type": "string",
          "description": "Size of the button",
          "enum": [
            "SMALL",
            "MEDIUM",
            "LARGE"
          ]
        },
        "actions": {
          "type": "array",
          "description": "Actions to perform when the CTA button is clicked",
          "items": {
            "$ref": "./commonWidgets/actions.json"
          }
        }
      }
    };
  }

  // Add products-related properties if needed
  if (hasProducts) {
    widgetDataProps.products = {
      "type": "array",
      "description": "List of products to display in the widget",
      "items": {
        "$ref": "./commonWidgets/product.json"
      }
    };
  }

  // Add slider-specific properties if needed
  if (isSlider) {
    widgetDataProps.slider = {
      "type": "object",
      "description": "Slider configuration",
      "properties": {
        "autoplay": {
          "type": "boolean",
          "description": "Whether the slider should automatically cycle through slides",
          "default": false
        },
        "autoplayInterval": {
          "type": "number",
          "description": "Time in milliseconds between auto-slides",
          "default": 5000
        },
        "showArrows": {
          "type": "boolean",
          "description": "Whether to show navigation arrows",
          "default": true
        },
        "showDots": {
          "type": "boolean",
          "description": "Whether to show navigation dots",
          "default": true
        },
        "slidesToShow": {
          "type": "number",
          "description": "Number of slides to show at once on mobile",
          "default": 1
        },
        "slidesToShowDesktop": {
          "type": "number",
          "description": "Number of slides to show at once on desktop",
          "default": 1
        }
      }
    };
  }

  // Add grid-specific properties if needed
  if (isGrid) {
    widgetDataProps.grid = {
      "type": "object",
      "description": "Grid configuration",
      "properties": {
        "columns": {
          "type": "number",
          "description": "Number of columns in the grid on mobile",
          "default": 1
        },
        "columnsDesktop": {
          "type": "number",
          "description": "Number of columns in the grid on desktop",
          "default": 3
        },
        "gap": {
          "type": "number",
          "description": "Gap between grid items (in pixels)",
          "default": 16
        }
      }
    };
  }

  // Add additional props
  if (additionalProps && Object.keys(additionalProps).length > 0) {
    Object.assign(widgetDataProps, additionalProps);
  }

  // Create a sample basic implementation in React
  const reactImplementation = `
import React from 'react';
import { Widget } from '../components/Widget';
${hasMedia ? "import { Media } from '../components/Media';" : ""}
${hasCta ? "import { Button } from '../components/Button';" : ""}
${hasProducts ? "import { ProductCard } from '../components/ProductCard';" : ""}
${isSlider ? "import { Slider } from '../components/Slider';" : ""}
${isGrid ? "import { Grid } from '../components/Grid';" : ""}

const ${widgetName.replace(/\s+/g, '')} = ({ widgetData, customClassName }) => {
  ${hasProducts ? "const { products = [] } = widgetData;" : ""}
  ${hasMedia ? "const { media, aspectRatio = 1 } = widgetData;" : ""}
  ${hasCta ? "const { cta } = widgetData;" : ""}
  ${isSlider ? "const { slider = {} } = widgetData;" : ""}
  ${isGrid ? "const { grid = {} } = widgetData;" : ""}

  return (
    <Widget className={\`${kebabCaseName}-widget \${customClassName || ''}\`}>
      ${hasMedia ? "<Media media={media} aspectRatio={aspectRatio} />" : ""}
      ${hasProducts && isGrid ? 
        "<Grid columns={grid.columns} columnsDesktop={grid.columnsDesktop} gap={grid.gap}>\n" +
        "        {products.map((product, index) => (\n" +
        "          <ProductCard key={index} product={product} />\n" +
        "        ))}\n" +
        "      </Grid>" : ""}
      ${hasProducts && isSlider ? 
        "<Slider {...slider}>\n" +
        "        {products.map((product, index) => (\n" +
        "          <ProductCard key={index} product={product} />\n" +
        "        ))}\n" +
        "      </Slider>" : ""}
      ${hasCta ? "<Button variant={cta.variant} size={cta.size}>{cta.label}</Button>" : ""}
    </Widget>
  );
};

export default ${widgetName.replace(/\s+/g, '')};
`;

  return {
    widgetName,
    fileName: `${kebabCaseName}-widget.json`,
    config: JSON.stringify(widgetConfig, null, 2),
    reactImplementation
  };
} 