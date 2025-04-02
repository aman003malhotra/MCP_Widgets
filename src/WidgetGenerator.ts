import { z } from 'zod';

// Types for widget generation
export interface WidgetTemplate {
  name: string;
  type: string;
  description: string;
  category: string;
  version: string;
  atomicComponents: string[];
  properties: Record<string, any>;
  styleOptions?: Record<string, any>;
  layout?: Record<string, any>;
}

// Zod schema for widget generation input
export const WidgetGeneratorSchema = z.object({
  name: z.string().min(3).describe('Name of the widget in kebab-case (e.g., "my-custom-widget")'),
  type: z.string().min(3).describe('Type of the widget in UPPER_SNAKE_CASE (e.g., "MY_CUSTOM_WIDGET")'),
  description: z.string().min(10).describe('Detailed description of the widget functionality'),
  category: z.enum(['product', 'media', 'layout', 'information', 'navigation', 'social']).describe('Category of the widget'),
  version: z.string().default('1.0.0').describe('Version of the widget'),
  atomicComponents: z.array(z.string()).min(1).describe('List of atomic component names to include in the widget'),
  properties: z.record(z.any()).describe('Custom properties specific to this widget'),
  styleOptions: z.record(z.any()).optional().describe('Optional style configurations'),
  layout: z.record(z.any()).optional().describe('Optional layout configurations')
});

// Helper function to convert to title case
function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Template samples for different widget types
const widgetTemplateSamples: Record<string, any> = {
  // Media grid template
  MEDIA_GRID: {
    componentStructure: {
      root: "div with className={styles.container}",
      header: "Optional header section with title and subtitle",
      grid: "Grid container with configurable columns and spacing",
      items: "Media items with image/video, optional title, and description"
    },
    sampleData: {
      widgetData: {
        items: [
          {
            media: {
              mediaType: "image",
              source: "https://example.com/image1.jpg",
              altText: "Example image 1",
              loading: "lazy"
            },
            title: "Image Title 1",
            description: "Optional description for this media item"
          },
          {
            media: {
              mediaType: "image",
              source: "https://example.com/image2.jpg",
              altText: "Example image 2",
              loading: "lazy"
            },
            title: "Image Title 2",
            description: "Optional description for this media item"
          }
        ],
        gridConfig: {
          columns: 3,
          columnsMobile: 1,
          columnsTablet: 2,
          gapX: 16,
          gapY: 16
        },
        showTitles: true,
        showDescriptions: true,
        enableLightbox: true
      },
      layout: {
        type: "FLUID",
        verticalSpacing: {
          top: "NORMAL",
          bottom: "NORMAL"
        }
      },
      header: {
        title: "Media Gallery",
        subtitle: "Explore our media collection",
        desktopTextAlign: "center"
      }
    },
    cssModuleSample: `
.container {
  width: 100%;
  padding: 0 16px;
}

.header {
  margin-bottom: 24px;
  text-align: center;
}

.title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 16px;
  color: #666;
}

.gridContainer {
  display: grid;
  grid-template-columns: repeat(var(--columns, 3), 1fr);
  gap: var(--gap, 16px);
}

.mediaItem {
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: transform 0.2s ease-in-out;
}

.mediaItem:hover {
  transform: translateY(-4px);
}

.mediaImage {
  width: 100%;
  aspect-ratio: 16/9;
  object-fit: cover;
  border-radius: 8px;
}

.mediaTitle {
  margin-top: 8px;
  font-weight: 600;
}

.mediaDescription {
  margin-top: 4px;
  color: #666;
  font-size: 14px;
}

@media (max-width: 768px) {
  .gridContainer {
    --columns: var(--columns-tablet, 2);
  }
}

@media (max-width: 480px) {
  .gridContainer {
    --columns: var(--columns-mobile, 1);
  }
}`,
    atomicComponentsUsage: [
      {
        component: "Image",
        usage: "For displaying media items",
        requiredProps: ["source", "altText"],
        optionalProps: ["loading", "className"]
      },
      {
        component: "Typography",
        usage: "For text elements like titles and descriptions",
        variants: ["HEADING_MEDIUM_BOLD", "BODY_BASE_REGULAR"]
      },
      {
        component: "Lightbox",
        usage: "For enlarging images when clicked",
        conditional: "enableLightbox"
      }
    ],
    reactComponentSample: `
import React from 'react';
import { MediaGridProps } from '../interfaces/media-grid.interface';
import styles from '../styles/media-grid.module.scss';
import { Image } from '../atomic/Image';
import { Typography, TypographyVariants } from '../atomic/Typography';
import { Lightbox } from '../atomic/Lightbox';

export const MediaGrid: React.FC<MediaGridProps> = ({
  widgetData,
  layout,
  header,
  ...props
}) => {
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  
  if (!widgetData?.items?.length) {
    return null;
  }

  const {
    gridConfig = { columns: 3, columnsMobile: 1, columnsTablet: 2, gapX: 16, gapY: 16 },
    showTitles = true,
    showDescriptions = true,
    enableLightbox = true
  } = widgetData;

  const handleItemClick = (index: number) => {
    if (enableLightbox) {
      setCurrentImageIndex(index);
      setLightboxOpen(true);
    }
  };

  return (
    <div className={styles.container}>
      {header && (
        <div className={styles.header}>
          {header.title && (
            <Typography variant={TypographyVariants.HEADING_MEDIUM}>
              {header.title}
            </Typography>
          )}
          {header.subtitle && (
            <Typography variant={TypographyVariants.BODY_BASE}>
              {header.subtitle}
            </Typography>
          )}
        </div>
      )}
      
      <div 
        className={styles.gridContainer} 
        style={{
          '--columns': gridConfig.columns,
          '--columns-mobile': gridConfig.columnsMobile,
          '--columns-tablet': gridConfig.columnsTablet,
          '--gap': \`\${gridConfig.gapY}px \${gridConfig.gapX}px\`,
        } as React.CSSProperties}
      >
        {widgetData.items.map((item, index) => (
          <div 
            key={index} 
            className={styles.mediaItem}
            onClick={() => handleItemClick(index)}
          >
            <Image
              source={item.media.source}
              altText={item.media.altText}
              loading={item.media.loading || 'lazy'}
              className={styles.mediaImage}
            />
            {showTitles && item.title && (
              <Typography variant="BODY_BASE_BOLD" className={styles.mediaTitle}>
                {item.title}
              </Typography>
            )}
            {showDescriptions && item.description && (
              <Typography variant="BODY_BASE_REGULAR" className={styles.mediaDescription}>
                {item.description}
              </Typography>
            )}
          </div>
        ))}
      </div>
      
      {enableLightbox && lightboxOpen && (
        <Lightbox
          images={widgetData.items.map(item => ({
            src: item.media.source,
            alt: item.media.altText,
            title: item.title
          }))}
          currentIndex={currentImageIndex}
          onClose={() => setLightboxOpen(false)}
          onNavigate={setCurrentImageIndex}
        />
      )}
    </div>
  );
};

export default MediaGrid;
`
  },
  // Add more widget type templates as needed
  PRODUCT_CARD_GRID: {
    // Similar structure for product grid
    // ...
  },
  MEDIA_SLIDER: {
    // Similar structure for media slider
    // ...
  }
};

// Main function to generate a new widget (only returns information, doesn't create files)
export async function generateWidget(widgetTemplate: WidgetTemplate): Promise<any> {
  try {
    // Create a component spec object without writing it to a file
    const widgetSpec = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: toTitleCase(widgetTemplate.name.replace(/-/g, ' ')) + ' Widget',
      description: widgetTemplate.description,
      type: 'object',
      category: widgetTemplate.category,
      version: widgetTemplate.version,
      properties: {
        widgetData: {
          type: 'object',
          description: 'Widget-specific data and configuration',
          properties: widgetTemplate.properties
        }
      }
    };
    
    // Provide comprehensive guidance on using atomic components to build the widget
    const atomicComponentsGuide = {
      importPath: './src/mono/web-components/components/atomic',
      importStatement: `// Import atomic components from the atom directory
import { BaseWidgetComponent } from './src/mono/web-components/components/atomic/BaseWidgetComponent';
import { Typography, TypographyVariants } from './src/mono/web-components/components/atomic/Typography';
${widgetTemplate.atomicComponents.filter(comp => comp !== 'Typography').map(comp => `import { ${comp} } from './src/mono/web-components/components/atomic/${comp}';`).join('\n')}

// Import styled components
import { ${toTitleCase(widgetTemplate.name).replace(/[-\s]/g, '')}Container } from '../styles/${widgetTemplate.name}.styles';`,
      usage: `
// All widgets should use BaseWidgetComponent as a wrapper and a single styled component
const ${toTitleCase(widgetTemplate.name).replace(/[-\s]/g, '')} = ({
  widgetData,
  layout,
  header,
  id, // IMPORTANT: Always use dynamic id from props
  ...props
}) => {
  if (!widgetData) {
    return null;
  }

  return (
    <BaseWidgetComponent 
      widgetType="${widgetTemplate.type}" 
      widgetId={id} // Use dynamic id from props
      layout={layout} // Use dynamic layout from props
    >
      {/* Use a SINGLE styled component with nested CSS */}
      <${toTitleCase(widgetTemplate.name).replace(/[-\s]/g, '')}Container>
        {header && (
          <div className="header">
            {header.title && (
              <Typography variant={TypographyVariants.HEADING_MEDIUM}>{header.title}</Typography>
            )}
            {header.subtitle && (
              <Typography variant={TypographyVariants.BODY_BASE}>{header.subtitle}</Typography>
            )}
          </div>
        )}
        
        <div className="content">
          {/* 
            Compose your widget using atoms from atomic-components.json:
            ${widgetTemplate.atomicComponents.join(', ')}
          */}
        </div>
      </${toTitleCase(widgetTemplate.name).replace(/[-\s]/g, '')}Container>
    </BaseWidgetComponent>
  );
};`,
      styledComponentExample: `
// In the styles file (${widgetTemplate.name}.styles.ts)
import styled from 'styled-components';

// IMPORTANT: Use ONLY ONE styled component
export const ${toTitleCase(widgetTemplate.name).replace(/[-\s]/g, '')}Container = styled.div\`
  display: flex;
  flex-direction: column;
  width: 100%;
  
  // Add widget-specific styles here using nested selectors
  // instead of creating multiple styled components
  .header {
    margin-bottom: 24px;
  }
  
  .content {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  }
  
  .item {
    padding: 16px;
    border-radius: 8px;
  }
\`;`,
      bestPractices: [
        "ALWAYS place widget files in ./src/mono/web-core/auditedWidgets/[widget-name]/",
        "ALWAYS add your widget type to Widget.map.ts file",
        "ONLY use atomic components from ./src/mono/web-components/components/atomic",
        "ALWAYS use BaseWidgetComponent as the root wrapper for your widget",
        "Create ONLY ONE styled component and use nested selectors for styling",
        "ALWAYS import and use TypographyVariants enum instead of string literals",
        "ALWAYS use dynamic props (id, layout, etc.) passed from parent components",
        "Provide sensible defaults for all widget properties",
        "Handle cases where data might be empty or undefined",
        "Follow React best practices for component composition",
        "Use TypeScript interfaces to define component props"
      ]
    };
    
    // Return the spec object, suggested path information, and atomic components guide
    return {
      widgetSpec,
      componentSpecPath: `component-spec/widgets/${widgetTemplate.name}-widget.json`,
      auditedWidgetsPath: `./src/mono/web-core/auditedWidgets/${widgetTemplate.name}`,
      atomicComponentsGuide,
      fileStructure: {
        component: `${widgetTemplate.name}.tsx`,
        styles: `${widgetTemplate.name}.styles.ts`,
        interface: `${widgetTemplate.name}.interface.ts`,
        test: `${widgetTemplate.name}.test.tsx`,
        story: `${widgetTemplate.name}.stories.tsx`
      }
    };
  } catch (error) {
    console.error('Failed to generate widget spec:', error);
    throw error;
  }
} 