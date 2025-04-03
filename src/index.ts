import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import cors from "cors";
import {
  Component,
  ComponentProp,
  Widget,
  AtomicComponentsData,
  WidgetData,
  ComponentSearchResult
} from "./index.interface.js";
import { BASE_WIDGET_MAP_TYPES } from "./WidgetMap.js";
import { FigmaComponentInputSchema } from './FigmaSchemas.js';
import { 
  WidgetGeneratorSchema, 
  generateWidget,
  WidgetTemplate
} from './WidgetGenerator.js';

// Define paths to component specs
const COMPONENT_SPEC_DIR = path.resolve(process.cwd(), "component-spec");
const ATOMIC_COMPONENTS_PATH = path.resolve(COMPONENT_SPEC_DIR, "atomic-components.json");
const MOLECULE_COMPONENTS_PATH = path.resolve(COMPONENT_SPEC_DIR, "molecule-components.json");
const WIDGETS_DIR = path.resolve(COMPONENT_SPEC_DIR, "widgets");
const AUDITED_WIDGETS_DIR = path.resolve(process.cwd(), "src", "mono", "web-core", "auditedWidgets");

// Component schemas
const ComponentPropSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.any().optional(),
  options: z.array(z.any()).optional(),
  subProps: z.record(z.any()).optional(),
});

const ComponentSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.string(),
  category: z.string(),
  properties: z.record(ComponentPropSchema),
  styles: z.record(z.any()).optional(),
  variantStyles: z.record(z.any()).optional(),
});

const WidgetSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.string(),
  category: z.string(),
  version: z.string(),
  properties: z.record(ComponentPropSchema),
});

// Add new schema for widget configuration
const MediaConfigSchema = z.object({
  mediaType: z.enum(['image', 'video']),
  source: z.string().url(),
  altText: z.string(),
  loading: z.enum(['lazy', 'eager']).default('lazy')
});

const LayoutConfigSchema = z.object({
  type: z.enum(['FLUID', 'FIXED']),
  verticalSpacing: z.object({
    top: z.enum(['COMPACT', 'NORMAL', 'LOOSE']),
    bottom: z.enum(['COMPACT', 'NORMAL', 'LOOSE'])
  })
});

const HeaderConfigSchema = z.object({
  subtitle: z.string().optional(),
  subtileType: z.enum(['PRIMARY', 'SECONDARY']).optional(),
  label: z.string().optional(),
  desktopTextAlign: z.enum(['left', 'center', 'right']).optional()
});

const SliderConfigSchema = z.object({
  aspectRatio: z.number(),
  slidesToShow: z.number(),
  slidesToShowDesktop: z.number(),
  showPeek: z.boolean(),
  showDots: z.boolean()
});

// Add type definitions for widget data extraction
interface ProductGridData {
  items: Array<{
    title: string;
    description?: string;
    imageUrl: string;
    price?: number;
    currency?: string;
    link?: string;
  }>;
  layout: {
    columns: number;
    gap: number;
  };
}

interface MediaSliderData {
  items: Array<{
    mediaType: 'image' | 'video';
    source: string;
    altText: string;
    loading?: 'lazy' | 'eager';
  }>;
  sliderConfig: {
    aspectRatio: number;
    slidesToShow: number;
    slidesToShowDesktop: number;
    showPeek: boolean;
    showDots: boolean;
  };
}

class PwaComponentMcpServer {
  private sseTransport: SSEServerTransport | null = null;
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: "pwa-component-spec",
      version: "1.0.0"
    });

    // Register resources
    this.server.resource(
      "atomic-components",
      "components://atomic",
      async () => {
              try {
                const data = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
                return { 
            contents: [{
              uri: "components://atomic",
              text: JSON.stringify(data, null, 2)
            }]
          };
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to load atomic components: ${errorMessage}`);
        }
      }
    );

    this.server.resource(
      "widgets",
      "components://widgets",
      async () => {
              try {
                const widgetFiles = fs.readdirSync(WIDGETS_DIR)
                  .filter(file => file.endsWith(".json"));
                
                const widgets: Record<string, WidgetData> = {};
                
                for (const file of widgetFiles) {
                  const filePath = path.join(WIDGETS_DIR, file);
                  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WidgetData;
                  const widgetName = file.replace(".json", "");
                  widgets[widgetName] = data;
                }
                
                return { 
            contents: [{
              uri: "components://widgets",
              text: JSON.stringify(widgets, null, 2)
            }]
          };
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to load widgets: ${errorMessage}`);
        }
      }
    );

    this.server.resource(
      "widget",
      new ResourceTemplate("components://widgets/{widgetName}", { list: undefined }),
      async (uri, { widgetName }) => {
        try {
                const filePath = path.join(WIDGETS_DIR, `${widgetName}.json`);
                
                if (!fs.existsSync(filePath)) {
            throw new Error(`Widget '${widgetName}' not found`);
                }
                
                const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WidgetData;
                return { 
            contents: [{
              uri: uri.href,
              text: JSON.stringify(data, null, 2)
            }]
          };
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to load widget: ${errorMessage}`);
        }
      }
    );

    // Register tools
    this.server.tool(
      "searchComponents",
      {
              query: z.string(),
        type: z.enum(["atomic", "widget", "molecule", "all"]).default("all")
      },
      async ({ query, type }) => {
              try {
                const results: ComponentSearchResult[] = [];
                const searchTerm = query.toLowerCase();
                
                if (type === "atomic" || type === "all") {
                  const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
                  
                  atomicData.components.forEach((component: Component) => {
                    if (
                      component.name.toLowerCase().includes(searchTerm) ||
                      component.description.toLowerCase().includes(searchTerm) ||
                      Object.keys(component.properties || {}).some(prop => prop.toLowerCase().includes(searchTerm))
                    ) {
                      results.push({
                        type: "atomic",
                        name: component.name,
                        description: component.description,
                        category: component.category,
                      });
                    }
                  });
                }
                
                if (type === "molecule" || type === "all") {
                  const moleculeData = JSON.parse(fs.readFileSync(MOLECULE_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
                  
                  moleculeData.components.forEach((component: Component) => {
                    if (
                      component.name.toLowerCase().includes(searchTerm) ||
                      component.description.toLowerCase().includes(searchTerm) ||
                      Object.keys(component.properties || {}).some(prop => prop.toLowerCase().includes(searchTerm)) ||
                      (component.atomicDependencies && 
                        component.atomicDependencies.some(dep => dep.toLowerCase().includes(searchTerm)))
                    ) {
                      results.push({
                        type: "molecule",
                        name: component.name,
                        description: component.description,
                        category: component.category,
                      });
                    }
                  });
                }
                
                if (type === "widget" || type === "all") {
                  const widgetFiles = fs.readdirSync(WIDGETS_DIR)
                    .filter(file => file.endsWith(".json"));
                  
                  for (const file of widgetFiles) {
                    try {
                      const filePath = path.join(WIDGETS_DIR, file);
                      const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                      
                      // Check if the file is a direct widget schema (not containing a widgets array)
                      if (!Array.isArray(widgetData.widgets)) {
                        // Extract widget info from the schema file
                        const widgetName = file.replace('.json', '');
                        const description = widgetData.description || widgetData.title || widgetName;
                        const category = widgetData.category || 'other';
                        
                        // Check if this widget matches the search term
                        if (
                          widgetName.toLowerCase().includes(searchTerm) ||
                          description.toLowerCase().includes(searchTerm) ||
                          // Search in properties if they exist
                          (widgetData.properties?.widgetData?.properties && 
                            Object.keys(widgetData.properties.widgetData.properties).some(
                              prop => prop.toLowerCase().includes(searchTerm)
                            )
                          )
                        ) {
                          results.push({
                            type: "widget",
                            name: widgetName,
                            description: description,
                            category: category,
                            file: file,
                          });
                        }
                      } else if (Array.isArray(widgetData.widgets)) {
                        // Legacy format with widgets array
                        widgetData.widgets.forEach((widget: Widget) => {
                          if (
                            widget.name.toLowerCase().includes(searchTerm) ||
                            widget.description.toLowerCase().includes(searchTerm) ||
                            Object.keys(widget.properties || {}).some(prop => prop.toLowerCase().includes(searchTerm))
                          ) {
                            results.push({
                              type: "widget",
                              name: widget.name,
                              description: widget.description,
                              category: widget.category,
                              file: file,
                            });
                          }
                        });
                      }
                    } catch (e) {
                      console.warn(`Error searching widget file ${file}:`, e);
                    }
                  }
                }
                
          return {
            content: [{
              type: "text",
              text: JSON.stringify(results, null, 2)
            }]
          };
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Search failed: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "getComponentProperties",
      {
              componentName: z.string(),
        componentType: z.enum(["atomic", "widget", "molecule"])
      },
      async ({ componentName, componentType }) => {
              try {
                // Load all component types to provide context
                const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
                const moleculeData = JSON.parse(fs.readFileSync(MOLECULE_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
                const widgetFiles = fs.readdirSync(WIDGETS_DIR).filter(file => file.endsWith(".json"));
                
                // Gather related components to help client make decisions
                const allAtomicComponents = atomicData.components.map((c: Component) => ({
                  name: c.name,
                  description: c.description,
                  category: c.category,
                  type: c.type,
                  numProps: Object.keys(c.properties || {}).length
                }));
                
                // Get all molecule components
                const allMoleculeComponents = moleculeData.components.map((c: Component) => ({
                  name: c.name,
                  description: c.description,
                  category: c.category,
                  type: c.type,
                  atomicDependencies: c.atomicDependencies || [],
                  numProps: Object.keys(c.properties || {}).length
                }));
                
                // Group atomic components by category for better reference
                const atomicComponentsByCategory: Record<string, any[]> = {};
                allAtomicComponents.forEach(comp => {
                  if (!atomicComponentsByCategory[comp.category]) {
                    atomicComponentsByCategory[comp.category] = [];
                  }
                  atomicComponentsByCategory[comp.category].push(comp);
                });
                
                // Get all widget summaries
                const allWidgetSummaries: any[] = [];
                for (const file of widgetFiles) {
                  try {
                    const filePath = path.join(WIDGETS_DIR, file);
                    const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                    
                    // Check if the file is a direct widget schema (not containing a widgets array)
                    if (!Array.isArray(widgetData.widgets)) {
                      // Extract widget info from the schema file
                      const widgetName = file.replace('.json', '');
                      const widget = {
                        name: widgetName,
                        description: widgetData.description || widgetData.title || widgetName,
                        category: widgetData.category || 'other',
                        type: widgetData.type || 'object',
                        version: widgetData.version || '1.0.0',
                        numProps: Object.keys(widgetData.properties?.widgetData?.properties || {}).length,
                        file
                      };
                      
                      allWidgetSummaries.push(widget);
                    } else if (Array.isArray(widgetData.widgets)) {
                      // Handle files with a widgets array (legacy format)
                      widgetData.widgets.forEach((w: Widget) => {
                        allWidgetSummaries.push({
                          name: w.name,
                          description: w.description,
                          category: w.category,
                          type: w.type,
                          numProps: Object.keys(w.properties || {}).length,
                          file: file
                        });
                      });
                    }
                  } catch (e) {
                    console.warn(`Error processing widget file ${file}:`, e);
                  }
                }
                
                // Now get specific component requested
                if (componentType === "atomic") {
                  const component = atomicData.components.find((c: Component) => c.name === componentName);
                  
                  if (!component) {
                    throw new Error(`Atomic component '${componentName}' not found`);
                  }
                  
                  // Find widgets that use this atomic component
                  const widgetsUsingComponent = allWidgetSummaries.filter(w => {
                    const widgetPath = path.join(WIDGETS_DIR, w.file);
                    try {
                      const content = fs.readFileSync(widgetPath, 'utf-8');
                      return content.includes(`"${componentName}"`) || content.includes(`'${componentName}'`);
                    } catch {
                      return false;
                    }
                  });
                  
                  // Find molecules that use this atomic component
                  const moleculesUsingComponent = allMoleculeComponents.filter(m => 
                    m.atomicDependencies.includes(componentName)
                  );
                  
                  return {
                    content: [{
                      type: "text",
                      text: JSON.stringify({
                        component: {
                          name: component.name,
                          description: component.description,
                          category: component.category,
                          type: component.type,
                          properties: component.properties,
                          relativePath: component.relativePath,
                          importPath: component.importPath
                        },
                        context: {
                          usedByWidgets: widgetsUsingComponent,
                          usedByMolecules: moleculesUsingComponent,
                          recommendedCombinations: moleculesUsingComponent.map(m => m.name)
                        },
                      }, null, 2)
                    }]
                  };
                } else if (componentType === "molecule") {
                  const component = moleculeData.components.find((c: Component) => c.name === componentName);
                  
                  if (!component) {
                    throw new Error(`Molecule component '${componentName}' not found`);
                  }
                  
                  // Find widgets that use this molecule component
                  const widgetsUsingComponent = allWidgetSummaries.filter(w => {
                    const widgetPath = path.join(WIDGETS_DIR, w.file);
                    try {
                      const content = fs.readFileSync(widgetPath, 'utf-8');
                      return content.includes(`"${componentName}"`) || content.includes(`'${componentName}'`);
                    } catch {
                      return false;
                    }
                  });
                  
                  // Get atomic components used by this molecule
                  const usedAtomicComponents = component.atomicDependencies || [];
                  const atomicComponentDetails = usedAtomicComponents.map(name => {
                    const comp = atomicData.components.find((c: Component) => c.name === name);
                    return comp ? {
                      name: comp.name,
                      description: comp.description,
                      category: comp.category,
                      properties: comp.properties,
                      relativePath: comp.relativePath,
                      importPath: comp.importPath
                    } : { name, error: "Component details not found" };
                  });
                  
                  return {
                    content: [{
                      type: "text",
                      text: JSON.stringify({
                        component: {
                          name: component.name,
                          description: component.description,
                          category: component.category,
                          type: component.type,
                          atomicDependencies: component.atomicDependencies,
                          properties: component.properties
                        },
                        context: {
                          usedByWidgets: widgetsUsingComponent,
                          usedAtomicComponents,
                          atomicComponentDetails,
                          
                        }
                      }, null, 2)
                    }]
                  };
                } else {
                  // Handle widget component lookup
                  let targetWidget = null;
                  let widgetFile = null;
                  
                  for (const file of widgetFiles) {
                    try {
                      const filePath = path.join(WIDGETS_DIR, file);
                      const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                      
                      const widgetName = file.replace('.json', '');
                      
                      // Check if this is the widget we're looking for
                      if (widgetName === componentName) {
                        targetWidget = {
                          name: widgetName,
                          description: widgetData.description || widgetData.title || widgetName,
                          category: widgetData.category || 'other',
                          type: widgetData.type || 'object',
                          version: widgetData.version || '1.0.0',
                          properties: widgetData.properties?.widgetData?.properties || {},
                          relativePath: widgetData.relativePath,
                        };
                        widgetFile = file;
                        break;
                      }
                      
                      // Also check legacy format with widgets array
                      if (Array.isArray(widgetData.widgets)) {
                        const widget = widgetData.widgets.find((w: Widget) => w.name === componentName);
                        
                        if (widget) {
                          targetWidget = widget;
                          widgetFile = file;
                          break;
                        }
                      }
                    } catch (e) {
                      console.warn(`Error processing widget file ${file} for lookup:`, e);
                    }
                  }
                  
                  if (!targetWidget) {
                    throw new Error(`Widget '${componentName}' not found`);
                  }
                  
                  // Find atomic components used by this widget
                  let usedAtomicComponents: string[] = [];
                  try {
                    const widgetPath = path.join(WIDGETS_DIR, widgetFile!);
                    const content = fs.readFileSync(widgetPath, 'utf-8');
                    // This is a simple extraction - a real implementation would do more sophisticated parsing
                    const atomicMatches = content.match(/"atomicComponents":\s*\[(.*?)\]/s);
                    if (atomicMatches && atomicMatches[1]) {
                      usedAtomicComponents = atomicMatches[1]
                        .replace(/"/g, '')
                        .replace(/'/g, '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(s => s);
                    }
                  } catch (e) {
                    console.warn(`Error extracting atomic components for ${componentName}:`, e);
                  }
                  
                  // Get detailed info about the atomic components this widget uses
                  const atomicComponentDetails = usedAtomicComponents.map(name => {
                    const comp = atomicData.components.find((c: Component) => c.name === name);
                    return comp ? {
                      name: comp.name,
                      description: comp.description,
                      category: comp.category,
                      properties: comp.properties,
                      relativePath: comp.relativePath,
                      importPath: comp.importPath
                    } : { name, error: "Component details not found" };
                  });
                  
                  return {
                    content: [{
                      type: "text",
                      text: JSON.stringify({
                        widget: {
                          name: targetWidget.name,
                          description: targetWidget.description,
                          category: targetWidget.category,
                          type: targetWidget.type,
                          properties: targetWidget.properties,
                          relativePath: targetWidget.relativePath,
                          importPath: targetWidget.importPath,
                          file: widgetFile
                        },
                        context: {
                          usedAtomicComponents,
                          atomicComponentDetails,
                          recommendedAtomicComponents: allAtomicComponents
                            .filter(c => c.category === targetWidget.category || usedAtomicComponents.includes(c.name))
                            .map(c => c.name)
                        }
                      }, null, 2)
                    }]
                  };
                }
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to get properties: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "getWidgetMap",
      {
        category: z.enum(['all', 'media', 'product', 'layout', 'social']).optional().default('all')
      },
      async ({ category }) => {
        try {
          const widgetMap = new Map();
          
          // Read all widget files to get their descriptions
          const widgetFiles = fs.readdirSync(WIDGETS_DIR)
            .filter(file => file.endsWith(".json") && !file.includes(".bak"));
          
          const widgetDescriptions = new Map();
          
          // Read widget files for basic metadata
          for (const file of widgetFiles) {
            const filePath = path.join(WIDGETS_DIR, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
              // Use the component name without -widget.json as the key
              const key = file.replace("-widget.json", "");
              
              widgetDescriptions.set(key, {
                description: data.description || "No description available",
                category: data.category || "unknown",
                version: data.version,
                title: data.title
              });
            } catch (error) {
              console.warn(`Could not read widget file ${file}:`, error);
            }
          }

          // Map widget types with their descriptions
          for (const [key, value] of Object.entries(BASE_WIDGET_MAP_TYPES)) {
            const widgetInfo = widgetDescriptions.get(key.toLowerCase().replace(/_/g, '-')) || {
              description: "No description available",
              category: "unknown"
            };

            if (category === 'all' || 
                (category === 'media' && key.includes('MEDIA')) ||
                (category === 'product' && key.includes('PRODUCT')) ||
                (category === 'layout' && ['GRID', 'SECTION', 'STRIP'].some(term => key.includes(term))) ||
                (category === 'social' && key.includes('SOCIAL'))) {
              widgetMap.set(key, {
                type: value,
                description: widgetInfo.description,
                category: widgetInfo.category,
                version: widgetInfo.version,
                title: widgetInfo.title,
                id: key.toLowerCase().replace(/_/g, '-')
              });
            }
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                total: widgetMap.size,
                widgets: Object.fromEntries(widgetMap)
              }, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to get widget map: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    // Add new tools after existing tools
    this.server.tool(
      "createWidgetConfig",
      {
        widgetName: z.string(),
        widgetType: z.enum(Object.values(BASE_WIDGET_MAP_TYPES) as [string, ...string[]]),
        layout: LayoutConfigSchema.optional(),
        header: HeaderConfigSchema.optional(),
        sliderConfig: SliderConfigSchema.optional(),
        mediaItems: z.array(MediaConfigSchema).optional()
      },
      async ({ widgetName, widgetType, layout, header, sliderConfig, mediaItems }) => {
        try {
          // First get the base config using getWidgetBaseConfig
          const baseConfigResponse = await this.getWidgetBaseConfig({
            widgetName,
            widgetType,
            category: 'information', // Default category, can be enhanced based on widgetType
            description: `A ${widgetName} widget for displaying content`,
            layoutType: layout?.type || 'FLUID',
            verticalSpacingTop: layout?.verticalSpacing?.top || 'COMPACT',
            verticalSpacingBottom: layout?.verticalSpacing?.bottom || 'COMPACT'
          });

          if (!baseConfigResponse.success) {
            throw new Error(`Failed to get base config: ${baseConfigResponse.message}`);
          }

          const baseConfig = baseConfigResponse.baseConfig;

          // Try to find widget specification in component-spec folder
          const widgetSpecPath = path.join(COMPONENT_SPEC_DIR, 'widgets', `${widgetType.toLowerCase()}-widget.json`);
          let widgetData = {};

          if (fs.existsSync(widgetSpecPath)) {
            // If widget spec exists, use it as template
            const widgetSpec = JSON.parse(fs.readFileSync(widgetSpecPath, 'utf-8'));
            widgetData = {
              ...widgetSpec.widgetData,
              // Override with provided values if any
              ...(mediaItems && { items: mediaItems.map(media => ({ media })) }),
              ...(sliderConfig && { sliderConfig })
            };
          } else {
            // For new widgets, provide base structure
            widgetData = {
              content: "Widget content goes here",
              settings: {
                showBorder: false
              }
            };
          }

          // Enhance the base config with provided parameters
          const enhancedConfig = {
            id: baseConfig.id,
            type: widgetType,
            header: {
              ...baseConfig.header,
              ...header
            },
            layout: {
              ...baseConfig.layout,
              ...layout
            },
            widgetData
          };

          // Create widget-configs directory if it doesn't exist
          const configDir = path.join(COMPONENT_SPEC_DIR, 'widget-configs');
          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }

          const configPath = path.join(configDir, `${widgetName}.json`);
          fs.writeFileSync(configPath, JSON.stringify(enhancedConfig, null, 2));

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Widget config created successfully at ${configPath}`,
                config: enhancedConfig
              }, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to create widget config: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "validateWidgetConfig",
      {
        widgetName: z.string(),
        widgetSpec: z.record(z.any()).optional()
      },
      async ({ widgetName, widgetSpec }) => {
        try {
          let config;
          
          if (widgetSpec) {
            config = widgetSpec;
          } else {
            const configPath = path.join(COMPONENT_SPEC_DIR, 'widget-configs', `${widgetName}.json`);
            if (!fs.existsSync(configPath)) {
              throw new Error(`Widget config '${widgetName}' not found`);
            }
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          }
          
          const validationResults = [];

          if (!config.name || !config.widgets || !Array.isArray(config.widgets)) {
            validationResults.push("Invalid basic structure: must have 'name' and 'widgets' array");
          }

          config.widgets.forEach((widget: any, index: number) => {
            if (!widget.type || !Object.values(BASE_WIDGET_MAP_TYPES).includes(widget.type)) {
              validationResults.push(`Widget ${index}: Invalid or missing type`);
            }

            if (widget.layout && !LayoutConfigSchema.safeParse(widget.layout).success) {
              validationResults.push(`Widget ${index}: Invalid layout configuration`);
            }

            if (widget.header && !HeaderConfigSchema.safeParse(widget.header).success) {
              validationResults.push(`Widget ${index}: Invalid header configuration`);
            }

            if (widget.widgetData?.sliderConfig && 
                !SliderConfigSchema.safeParse(widget.widgetData.sliderConfig).success) {
              validationResults.push(`Widget ${index}: Invalid slider configuration`);
            }

            if (widget.widgetData?.items) {
              widget.widgetData.items.forEach((item: any, itemIndex: number) => {
                if (!MediaConfigSchema.safeParse(item.media).success) {
                  validationResults.push(`Widget ${index}, Item ${itemIndex}: Invalid media configuration`);
                }
              });
            }
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                isValid: validationResults.length === 0,
                validationErrors: validationResults,
                config: validationResults.length === 0 ? config : undefined,
                savePath: `${COMPONENT_SPEC_DIR}/widgets/${widgetName}-widget.json`
              }, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Validation failed: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "updateWidgetConfig",
      {
        widgetName: z.string(),
        updates: z.object({
          layout: LayoutConfigSchema.optional(),
          header: HeaderConfigSchema.optional(),
          sliderConfig: SliderConfigSchema.optional(),
          mediaItems: z.array(MediaConfigSchema).optional()
        })
      },
      async ({ widgetName, updates }) => {
        try {
          const configPath = path.join(COMPONENT_SPEC_DIR, 'widget-configs', `${widgetName}.json`);
          if (!fs.existsSync(configPath)) {
            throw new Error(`Widget config '${widgetName}' not found`);
          }

          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          
          if (!config.widgets?.[0]) {
            throw new Error('Invalid widget configuration structure');
          }

          const widget = config.widgets[0];
          
          if (updates.layout) widget.layout = updates.layout;
          if (updates.header) widget.header = updates.header;
          if (updates.sliderConfig || updates.mediaItems) {
            widget.widgetData = widget.widgetData || {};
            if (updates.sliderConfig) widget.widgetData.sliderConfig = updates.sliderConfig;
            if (updates.mediaItems) {
              widget.widgetData.items = updates.mediaItems.map(media => ({ media }));
            }
          }

          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

          return {
            content: [{
              type: "text",
              text: JSON.stringify(config, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to update widget config: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "convertFigmaToWidget",
      {
        figmaInput: FigmaComponentInputSchema
      },
      async ({ figmaInput }) => {
        try {
          const { node, componentName } = figmaInput as z.infer<typeof FigmaComponentInputSchema>;
          
          // Detect widget type
          const detectedType = detectWidgetTypeFromFigma(node);
          
          // Extract common configurations
          const layout = convertFigmaToLayout(node);
          const header = extractHeaderFromFigma(node);
          const widgetData = extractWidgetDataFromFigma(node, detectedType);
          
          // Construct widget configuration
          const widgetConfig = {
            name: componentName,
            type: detectedType,
            layout,
            header,
            ...widgetData
          };
          
          // Validate configuration
          const validationResult = validateWidgetConfig(widgetConfig, detectedType);
          
          if (validationResult.isValid) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify(widgetConfig, null, 2)
              }]
            };
          } else {
            return {
              content: [{
                type: "text",
                text: `Validation failed: ${validationResult.errors.join(', ')}`
              }],
              isError: true
            };
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to convert Figma to widget: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "getWidgetBaseConfig",
      {
        widgetName: z.string().min(3),
        widgetType: z.string(),
        category: z.enum(['product', 'media', 'layout', 'information', 'navigation', 'social']).default('information'),
        description: z.string().optional(),
        layoutType: z.enum(['CONTAINED', 'FLUID']).optional().default('FLUID'),
        verticalSpacingTop: z.enum(['NONE', 'COMPACT', 'GENEROUS']).optional().default('COMPACT'),
        verticalSpacingBottom: z.enum(['NONE', 'COMPACT', 'GENEROUS']).optional().default('COMPACT')
      },
      async ({ widgetName, widgetType, category, description, layoutType = 'FLUID', verticalSpacingTop = 'COMPACT', verticalSpacingBottom = 'COMPACT' }) => {
        try {
          // Normalize widgetType if needed
          const normalizedType = widgetType.toUpperCase().replace(/-/g, '_');
          
          // Create basic config structure based on BaseWidget interface
          const baseConfig = {
            id: `${widgetName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
            name: widgetName,
            type: normalizedType,
            category,
            description: description || `${widgetName} widget for displaying ${category} content`,
            header: {
              title: `${widgetName} Title`,
              subtitle: `${widgetName} Subtitle`
            },
            layout: {
              type: layoutType, // 'CONTAINED' or 'FLUID'
              verticalSpacing: {
                top: verticalSpacingTop, // 'NONE', 'COMPACT', or 'GENEROUS'
                bottom: verticalSpacingBottom // 'NONE', 'COMPACT', or 'GENEROUS'
              },
              backgroundColor: '#FFFFFF',
              backgroundImage: '' // Empty by default
            },
            widgetData: {}
          };
          
          // Add different template data based on category
          switch (category) {
            case 'product':
              baseConfig.widgetData = {
                items: [
                  {
                    id: 'product-1',
                    title: 'Product 1',
                    description: 'Product 1 description',
                    imageUrl: 'https://example.com/product1.jpg',
                    price: 99.99,
                    currency: 'USD',
                    link: 'https://example.com/product1'
                  },
                  {
                    id: 'product-2',
                    title: 'Product 2',
                    description: 'Product 2 description',
                    imageUrl: 'https://example.com/product2.jpg',
                    price: 149.99,
                    currency: 'USD',
                    link: 'https://example.com/product2'
                  }
                ],
                settings: {
                  columns: 2,
                  showBorder: true,
                  theme: 'light'
                }
              };
              break;
            
            case 'media':
              baseConfig.widgetData = {
                items: [
                  {
                    mediaType: 'image',
                    source: 'https://example.com/image1.jpg',
                    altText: 'Example image 1',
                    loading: 'lazy'
                  },
                  {
                    mediaType: 'video',
                    source: 'https://example.com/video1.mp4',
                    altText: 'Example video 1',
                    loading: 'lazy'
                  }
                ],
                sliderConfig: {
                  aspectRatio: 16/9,
                  slidesToShow: 1,
                  slidesToShowDesktop: 1,
                  showPeek: false,
                  showDots: true
                }
              };
              break;
            
            case 'layout':
              baseConfig.widgetData = {
                sections: [
                  {
                    id: 'section-1',
                    title: 'Section 1',
                    content: 'Section 1 content goes here'
                  },
                  {
                    id: 'section-2',
                    title: 'Section 2',
                    content: 'Section 2 content goes here'
                  }
                ],
                settings: {
                  sectionGap: 16,
                  showDividers: true
                }
              };
              break;
              
            case 'information':
              baseConfig.widgetData = {
                title: 'Information Title',
                body: 'This is the main information content for this widget.',
                icon: 'info',
                style: 'card',
                actions: [
                  {
                    label: 'Learn More',
                    url: 'https://example.com/info'
                  }
                ]
              };
              break;
              
            case 'navigation':
              baseConfig.widgetData = {
                links: [
                  {
                    label: 'Home',
                    url: '/',
                    icon: 'home'
                  },
                  {
                    label: 'Products',
                    url: '/products',
                    icon: 'shopping-bag'
                  },
                  {
                    label: 'About',
                    url: '/about',
                    icon: 'info'
                  }
                ],
                settings: {
                  orientation: 'horizontal',
                  style: 'tabs'
                }
              };
              break;
              
            case 'social':
              baseConfig.widgetData = {
                platforms: [
                  {
                    name: 'Twitter',
                    icon: 'twitter',
                    url: 'https://twitter.com/example'
                  },
                  {
                    name: 'Instagram',
                    icon: 'instagram',
                    url: 'https://instagram.com/example'
                  },
                  {
                    name: 'Facebook',
                    icon: 'facebook',
                    url: 'https://facebook.com/example'
                  }
                ],
                showLabels: true,
                iconSize: 'medium'
              };
              break;
          }
          
          // Generate TypeScript interface from the structure
          const interfaceDefinition = `// TypeScript interface for ${widgetName}
export type WidgetLayoutType = 'CONTAINED' | 'FLUID';
export type VerticalSpacing = 'NONE' | 'COMPACT' | 'GENEROUS';

export interface ${widgetName.replace(/\s+/g, '')}Data {
${generateInterfaceFromStructure(baseConfig.widgetData, '  ')}
}

export interface ${widgetName.replace(/\s+/g, '')}Props extends BaseWidgetProps<${widgetName.replace(/\s+/g, '')}Data> {
  // Add any additional props here
}`;

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                widgetName,
                widgetType: normalizedType,
                baseConfig,
                interfaceDefinition,
                howToUse: {
                  description: "This config provides a basic structure for your widget based on the BaseWidget interface.",
                  step1: "Copy and customize the widget configuration according to your needs.",
                  step2: "Use the TypeScript interface in your widget component file.",
                  step3: "Implement your widget component using the props structure."
                },
                layoutOptions: {
                  types: ['CONTAINED', 'FLUID'],
                  verticalSpacing: ['NONE', 'COMPACT', 'GENEROUS']
                }
              }, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                message: `Failed to generate widget base config: ${errorMessage}`
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "addWidgetToMap",
      {
        widgetName: z.string().min(3),
        widgetType: z.string().min(3)
      },
      async ({ widgetName, widgetType }) => {
        try {
          // Normalize widget type to uppercase with underscores
          const normalizedType = widgetType.toUpperCase().replace(/-/g, '_');
          
          // Check if the widget type already exists in WidgetMap.ts
          const widgetMapPath = path.resolve(process.cwd(), "src", "WidgetMap.ts");
          
          if (!fs.existsSync(widgetMapPath)) {
            throw new Error("WidgetMap.ts file not found at " + widgetMapPath);
          }
          
          let widgetMapContent = fs.readFileSync(widgetMapPath, "utf-8");
          
          // Check if the widget type already exists
          if (widgetMapContent.includes(`${normalizedType}:`)) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  message: `Widget type ${normalizedType} already exists in WidgetMap.ts`,
                  widgetType: normalizedType
                }, null, 2)
              }],
              isError: true
            };
          }
          
          // Find the last entry in the BASE_WIDGET_MAP_TYPES object
          const lastEntryMatch = widgetMapContent.match(/(\s+)[\w_]+:\s*'[\w_]+',\n(\s*})/);
          
          if (!lastEntryMatch) {
            throw new Error("Could not find a valid pattern in WidgetMap.ts to update");
          }
          
          const [fullMatch, indentation, closingBrace] = lastEntryMatch;
          
          // Add the new type before the closing brace
          const replacement = `${indentation}${normalizedType}: '${normalizedType}',\n${closingBrace}`;
          widgetMapContent = widgetMapContent.replace(fullMatch, replacement);
          
          // Write the updated content back to the file
          fs.writeFileSync(widgetMapPath, widgetMapContent);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Widget type ${normalizedType} successfully added to WidgetMap.ts`,
                widgetType: normalizedType,
                nextStep: {
                  tool: "generateWidget",
                  params: {
                    name: widgetName,
                    type: normalizedType
                  },
                  description: "Now you can generate widget files with the updated widget type"
                }
              }, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                message: `Failed to add widget type to WidgetMap.ts: ${errorMessage}`
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      "getComponentLibrary",
      {
        includeDetails: z.boolean().optional().default(false)
      },
      async ({ includeDetails = false }) => {
        includeDetails = false;
        try {
          console.log(`Retrieving component library ${includeDetails ? 'with' : 'without'} detailed information`);
          
          // Load atomic components data
          const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
          
          // Load molecule components data
          const moleculeData = JSON.parse(fs.readFileSync(MOLECULE_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
          
          // Load widget data from all widget files
          const widgetFiles = fs.readdirSync(WIDGETS_DIR).filter(file => file.endsWith(".json"));
          const allWidgets: any[] = [];
          
          for (const file of widgetFiles) {
            try {
              const filePath = path.join(WIDGETS_DIR, file);
              const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
              
              // Check if the file is a direct widget schema (not containing a widgets array)
              if (!Array.isArray(widgetData.widgets)) {
                // Extract widget info from the schema file
                const widgetName = file.replace('.json', '');
                const widget = {
                  name: widgetName,
                  description: widgetData.description || widgetData.title || widgetName,
                  category: widgetData.category || 'other',
                  type: widgetData.type || 'object',
                  version: widgetData.version || '1.0.0',
                  // props: widgetData.properties?.widgetData?.properties || {},
                  file
                };
                
                allWidgets.push(widget);
              } else if (Array.isArray(widgetData.widgets)) {
                // Handle files with a widgets array (legacy format)
                widgetData.widgets.forEach((w: Widget) => {
                  allWidgets.push({
                    ...w,
                    file
                  });
                });
              }
            } catch (e) {
              console.warn(`Error loading widget from ${file}:`, e);
            }
          }
          
          // Get components by type
          const atomicComponents = atomicData.components;
          const moleculeComponents = moleculeData.components;
          
          // Create summaries
          const atomicSummary = atomicComponents.map(c => ({
            name: c.name,
            description: c.description,
            category: c.category,
            type: c.type,
            numProps: Object.keys(c.properties || {}).length
          }));
          
          const moleculeSummary = moleculeComponents.map(c => ({
            name: c.name,
            description: c.description, 
            category: c.category,
            type: c.type,
            atomicDependencies: c.atomicDependencies || [],
            numProps: Object.keys(c.properties || {}).length
          }));
          
          const widgetSummary = allWidgets.map(w => ({
            name: w.name,
            description: w.description,
            category: w.category,
            type: w.type,
            version: w.version,
            file: w.file,
            numProps: Object.keys(w.properties || {}).length
          }));
          
          // Group components by category
          const groupByCategory = (components: any[]) => {
            const grouped: Record<string, any[]> = {};
            components.forEach(comp => {
              const category = comp.category || 'other';
              if (!grouped[category]) {
                grouped[category] = [];
              }
              grouped[category].push(comp);
            });
            return grouped;
          };
          
          // Calculate stats
          const componentStats = {
            totalAtoms: atomicComponents.length,
            totalMolecules: moleculeComponents.length,
            totalWidgets: allWidgets.length,
            categoryCounts: {
              atomic: Object.entries(groupByCategory(atomicComponents)).map(([category, comps]) => ({
                category,
                count: comps.length
              })),
              molecules: Object.entries(groupByCategory(moleculeComponents)).map(([category, comps]) => ({
                category, 
                count: comps.length
              })),
              widgets: Object.entries(groupByCategory(allWidgets)).map(([category, comps]) => ({
                category,
                count: comps.length
              }))
            }
          };
          
          // Find relationships between components
          const componentRelationships = [];
          
          // Map which atomic components are used by which molecules
          const atomicUsage: Record<string, string[]> = {};
          
          moleculeComponents.forEach(molecule => {
            (molecule.atomicDependencies || []).forEach(atomName => {
              if (!atomicUsage[atomName]) {
                atomicUsage[atomName] = [];
              }
              atomicUsage[atomName].push(molecule.name);
            });
          });
          
          if (includeDetails) {
            // Find complementary components (components often used together)
            // This would require parsing actual usage patterns from the files
            // For now, we'll use a simplified approach based on dependencies
            
            componentRelationships.push({
              type: "atomic-to-molecule",
              relationships: Object.entries(atomicUsage).map(([atom, molecules]) => ({
                component: atom,
                usedIn: molecules
              }))
            });
          }
          
          // Create the response
          const response = {
            summary: {
              atoms: atomicSummary.length,
              molecules: moleculeSummary.length,
              widgets: widgetSummary.length,
              total: atomicSummary.length + moleculeSummary.length + widgetSummary.length
            },
            components: {
              atoms: atomicSummary,
              molecules: moleculeSummary,
              widgets: widgetSummary
            },
            categorized: {
              atoms: groupByCategory(atomicSummary),
              molecules: groupByCategory(moleculeSummary),
              widgets: groupByCategory(widgetSummary)
            },
            stats: componentStats,
            relationships: includeDetails ? componentRelationships : undefined,
            recommendations: {
              popularAtoms: atomicSummary
                .filter(a => Object.keys(atomicUsage).includes(a.name))
                .sort((a, b) => 
                  (atomicUsage[b.name]?.length || 0) - (atomicUsage[a.name]?.length || 0)
                )
                .slice(0, 5),
              commonCombinations: includeDetails ? moleculeSummary
                .filter(m => (m.atomicDependencies || []).length > 1)
                .map(m => ({
                  name: m.name,
                  components: m.atomicDependencies
                }))
                .slice(0, 5) : []
            }
          };
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response, null, 2)
            }]
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to retrieve component library: ${errorMessage}`
            }],
            isError: true
          };
        }
      }
    );
  }

  private async getWidgetBaseConfig(params: {
    widgetName: string;
    widgetType: string;
    category: string;
    description: string;
    layoutType: string;
    verticalSpacingTop: string;
    verticalSpacingBottom: string;
  }): Promise<{
    success: boolean;
    message?: string;
    baseConfig?: any;
  }> {
    try {
      // Create basic config structure based on BaseWidget interface
      const baseConfig = {
        id: `${params.widgetName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        name: params.widgetName,
        type: params.widgetType,
        category: params.category,
        description: params.description,
        header: {
          title: `${params.widgetName} Title`,
          subtitle: `${params.widgetName} Subtitle`
        },
        layout: {
          type: params.layoutType,
          verticalSpacing: {
            top: params.verticalSpacingTop,
            bottom: params.verticalSpacingBottom
          },
          backgroundColor: '#FFFFFF',
          backgroundImage: ''
        },
        widgetData: {}
      };

      return {
        success: true,
        baseConfig
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async connect(transport: SSEServerTransport) {
    await this.server.connect(transport);
    this.sseTransport = transport;
    console.log("Server connected and ready to process requests");
  }

  async startHttpServer(port: number) {
    const app = express();
    app.use(cors());

    // SSE endpoint
    app.get("/sse", async (req: express.Request, res: express.Response) => {
      console.log("New SSE connection established");
      const transport = new SSEServerTransport("/messages", res);
      await this.connect(transport);
    });

    // Message endpoint for handling client messages
    app.post("/messages", async (req: express.Request, res: express.Response) => {
      if (!this.sseTransport) {
        res.sendStatus(400);
        return;
      }
      await this.sseTransport.handlePostMessage(req, res);
    });

    app.listen(port, () => {
      console.log(`HTTP server listening on port ${port}`);
      console.log(`SSE endpoint available at http://localhost:${port}/sse`);
      console.log(`Message endpoint available at http://localhost:${port}/messages`);
    });
  }
}

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
  const server = new PwaComponentMcpServer();
  await server.startHttpServer(port);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

// Helper functions for Figma conversion
function detectWidgetTypeFromFigma(node: any): string {
  // Detect widget type based on node structure and naming
  if (node.name.toLowerCase().includes('slider')) {
    return 'MEDIA_SLIDER';
  }
  if (node.name.toLowerCase().includes('grid')) {
    return 'PRODUCT_CARD_GRID';
  }
  // Add more detection logic
  return 'MEDIA_SLIDER'; // Default fallback
}

// Helper function to generate TypeScript interface from a structure object
function generateInterfaceFromStructure(structure: any, indent: string = "  "): string {
  if (!structure || typeof structure !== 'object') {
    return indent + "// No structure defined\n";
  }
  
  let result = "";
  
  if (Array.isArray(structure)) {
    // Handle array type
    if (structure.length === 0) {
      return indent + "items?: any[];\n";
    } else {
      const firstItem = structure[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        result += indent + "items?: Array<{\n";
        result += generateInterfaceFromStructure(firstItem, indent + "  ");
        result += indent + "}>;\n";
      } else {
        // Simple array of primitives
        const type = typeof firstItem;
        result += indent + `items?: ${type}[];\n`;
      }
    }
  } else {
    // Handle object type
    for (const [key, value] of Object.entries(structure)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result += indent + `${key}?: {\n`;
        result += generateInterfaceFromStructure(value, indent + "  ");
        result += indent + "};\n";
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          result += indent + `${key}?: any[];\n`;
        } else {
          const firstItem = value[0];
          if (typeof firstItem === 'object' && firstItem !== null) {
            result += indent + `${key}?: Array<{\n`;
            result += generateInterfaceFromStructure(firstItem, indent + "  ");
            result += indent + "}>;\n";
          } else {
            // Simple array of primitives
            const type = typeof firstItem;
            result += indent + `${key}?: ${type}[];\n`;
          }
        }
      } else {
        // Handle primitive types
        const type = typeof value;
        if (type === 'string' && (value as string).match(/^(https?:\/\/|\/)/)) {
          // URL strings
          result += indent + `${key}?: string; // URL\n`;
        } else if (type === 'number' && (value as number) % 1 === 0) {
          result += indent + `${key}?: number; // integer\n`;
        } else if (type === 'number') {
          result += indent + `${key}?: number; // float\n`;
        } else {
          result += indent + `${key}?: ${type};\n`;
        }
      }
    }
  }
  
  return result;
}

// Helper function to create default structure based on category
function createDefaultStructureByCategory(category: string): any {
  switch (category) {
    case 'product':
      return {
        items: [{
          title: "Product Title",
          description: "Product description...",
          imageUrl: "https://example.com/image.jpg",
          price: 99.99,
          currency: "USD"
        }],
        layout: {
          columns: 3,
          gap: 16
        }
      };
    case 'media':
      return {
        items: [{
          mediaType: "image",
          source: "https://example.com/image.jpg",
          altText: "Media description",
          caption: "Optional caption"
        }],
        sliderConfig: {
          aspectRatio: 1.78,
          slidesToShow: 1,
          slidesToShowDesktop: 3,
          showPeek: true,
          showDots: true
        }
      };
    case 'navigation':
      return {
        items: [{
          label: "Navigation Link",
          url: "/page",
          isExternal: false,
          icon: "arrow-right"
        }],
        layout: {
          direction: "horizontal",
          alignment: "center"
        }
      };
    default:
      return {
        // Generic structure for other categories
        content: "Widget content goes here",
        settings: {
          showBorder: false
        }
      };
  }
}

// Helper function to convert string to Title Case
function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Helper function to generate default value based on prop type
function getDefaultValueForType(type: string): string {
  switch (type.toLowerCase()) {
    case 'string':
      return '"value"';
    case 'number':
      return '0';
    case 'boolean':
      return 'true';
    case 'function':
      return '() => {}';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    case 'enum':
      return '"option"';
    case 'react.reactnode':
      return '<div>Content</div>';
    default:
      return '{}';
  }
}

function convertFigmaToLayout(node: any) {
  if (!node.layout) return null;

  return {
    type: node.layout.layoutMode === 'NONE' ? 'FIXED' : 'FLUID',
    verticalSpacing: {
      top: convertFigmaSpacing(node.layout.padding?.top),
      bottom: convertFigmaSpacing(node.layout.padding?.bottom)
    }
  };
}

function convertFigmaSpacing(spacing: number | undefined): 'COMPACT' | 'NORMAL' | 'LOOSE' {
  if (!spacing) return 'NORMAL';
  if (spacing <= 16) return 'COMPACT';
  if (spacing >= 32) return 'LOOSE';
  return 'NORMAL';
}

function extractHeaderFromFigma(node: any) {
  // Look for text nodes that might be headers
  const textNodes = findTextNodes(node);
  if (textNodes.length === 0) return null;

  const header: any = {};
  
  // Find subtitle and label
  textNodes.forEach(textNode => {
    if (textNode.textStyle?.fontSize >= 24) {
      header.label = textNode.characters;
    } else if (textNode.textStyle?.fontSize >= 16) {
      header.subtitle = textNode.characters;
    }
  });

  if (Object.keys(header).length === 0) return null;

  // Get text alignment
  const mainTextNode = textNodes[0];
  header.desktopTextAlign = convertFigmaTextAlign(mainTextNode.textStyle?.textAlignHorizontal);

  return header;
}

function extractWidgetDataFromFigma(node: any, widgetType: string) {
  switch (widgetType) {
    case 'MEDIA_SLIDER':
      return extractMediaSliderData(node);
    case 'PRODUCT_CARD_GRID':
      return extractProductGridData(node);
    // Add more widget type handlers
    default:
      return null;
  }
}

function extractMediaSliderData(node: any) {
  const imageNodes = findImageNodes(node);
  const aspectRatio = imageNodes[0]?.width / imageNodes[0]?.height || 1;

  return {
    sliderConfig: {
      aspectRatio,
      slidesToShow: 1,
      slidesToShowDesktop: Math.min(imageNodes.length, 3),
      showPeek: true,
      showDots: imageNodes.length > 3
    },
    showBorder: false,
    items: imageNodes.map(imgNode => ({
      media: {
        mediaType: 'image',
        source: extractImageUrl(imgNode),
        altText: imgNode.name,
        loading: 'lazy'
      }
    }))
  };
}

function findTextNodes(node: any): any[] {
  const textNodes: any[] = [];
  if (node.type === 'TEXT') {
    textNodes.push(node);
  }
  if (node.children) {
    node.children.forEach((child: any) => {
      textNodes.push(...findTextNodes(child));
    });
  }
  return textNodes;
}

function findImageNodes(node: any): any[] {
  const imageNodes: any[] = [];
  if (node.type === 'RECTANGLE' && node.style?.fills?.some((fill: any) => fill.type === 'IMAGE')) {
    imageNodes.push(node);
  }
  if (node.children) {
    node.children.forEach((child: any) => {
      imageNodes.push(...findImageNodes(child));
    });
  }
  return imageNodes;
}

function convertFigmaTextAlign(align: string | undefined): 'left' | 'center' | 'right' {
  switch (align) {
    case 'LEFT':
      return 'left';
    case 'CENTER':
      return 'center';
    case 'RIGHT':
      return 'right';
    default:
      return 'left';
  }
}

function extractImageUrl(node: any): string {
  const imageFill = node.style?.fills?.find((fill: any) => fill.type === 'IMAGE');
  return imageFill?.imageRef || '';
}

function validateWidgetConfig(config: any, widgetType: string) {
  // Add validation logic based on widget type
  const errors: string[] = [];
  
  if (!config.name) {
    errors.push('Widget name is required');
  }
  
  if (!config.widgets || !Array.isArray(config.widgets) || config.widgets.length === 0) {
    errors.push('Widget configuration must contain at least one widget');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

function extractProductGridData(node: any): ProductGridData {
  const items = findImageNodes(node).map(imageNode => {
    const textNodes = findTextNodes(imageNode.parent);
    return {
      title: textNodes[0]?.characters || '',
      description: textNodes[1]?.characters,
      imageUrl: extractImageUrl(imageNode),
      price: parseFloat(textNodes.find(n => n.name.toLowerCase().includes('price'))?.characters || '0'),
      currency: textNodes.find(n => n.name.toLowerCase().includes('currency'))?.characters,
      link: imageNode.parent.link?.url
    };
  });

  return {
    items,
    layout: {
      columns: Math.min(4, items.length),
      gap: node.itemSpacing || 16
    }
  };
}
