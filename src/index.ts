// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import cors from "cors";
import {
  Component,
  Widget,
  AtomicComponentsData,
  WidgetData,
  ComponentSearchResult
} from "./index.interface.js";
import { BASE_WIDGET_MAP_TYPES } from "./WidgetMap.js";

// Define paths to component specs
const COMPONENT_SPEC_DIR = path.resolve(process.cwd(), "component-spec");
const ATOMIC_COMPONENTS_PATH = path.resolve(COMPONENT_SPEC_DIR, "atomic-components.json");
const MOLECULE_COMPONENTS_PATH = path.resolve(COMPONENT_SPEC_DIR, "molecule-components.json");
const WIDGETS_DIR = path.resolve(COMPONENT_SPEC_DIR, "widgets");

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
      async (uri: URL, variables: Record<string, string | string[]>, extra: { signal: AbortSignal; sessionId?: string }) => {
        try {
                const widgetName = variables.widgetName as string;
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
        type: z.enum(["atomic", "widget", "molecule", "all"]).default("all"),
        propertySearch: z.string().optional(),
        fuzzyMatch: z.boolean().optional().default(true),
        includeSnippets: z.boolean().optional().default(false),
        includePopularity: z.boolean().optional().default(false)
      },
      async ({ query, type, propertySearch, fuzzyMatch = true, includeSnippets = false, includePopularity = false }: { 
        query: string;
        type: string;
        propertySearch?: string;
        fuzzyMatch?: boolean;
        includeSnippets?: boolean;
        includePopularity?: boolean;
      }) => {
        try {
          const results: (ComponentSearchResult & { 
            popularity?: number;
            usageCount?: number;
            codeSnippet?: string;
            matchScore?: number;
            matchedProperties?: string[];
          })[] = [];
          
          const searchTerm = query.toLowerCase();
          
          // Usage metrics for popularity data
          const componentUsage = new Map<string, number>();
          
          // Helper function for fuzzy matching
          function performFuzzyMatch(text: string, pattern: string): { match: boolean; score: number } {
            if (!pattern || !text) return { match: false, score: 0 };
            
            text = text.toLowerCase();
            pattern = pattern.toLowerCase();
            
            // Exact match gets highest score
            if (text === pattern) return { match: true, score: 1 };
            
            // Contains match
            if (text.includes(pattern)) return { match: true, score: 0.8 };
            
            // Check for partial matches (start of word)
            const words = text.split(/\s+/);
            for (const word of words) {
              if (word.startsWith(pattern)) return { match: true, score: 0.7 };
            }
            
            // Allow for typos and transposed letters
            let matchCount = 0;
            const patternChars = pattern.split('');
            
            let lastIndex = -1;
            for (const char of patternChars) {
              const index = text.indexOf(char, lastIndex + 1);
              if (index > lastIndex) {
                matchCount++;
                lastIndex = index;
              }
            }
            
            const score = matchCount / pattern.length;
            return { match: score > 0.6, score };
          }
          
          // Helper function to generate a code snippet
          function generateSnippet(component: any, componentType: string): string {
            try {
              switch (componentType) {
                case 'atomic':
                  return `import { ${component.name} } from "${component.importPath || '@components/atomic'}";

// Example usage
<${component.name} ${Object.entries(component.properties || {})
  .filter(([_, prop]: [string, any]) => prop.required)
  .map(([key, prop]: [string, any]) => `${key}={${prop.defaultValue !== undefined ? JSON.stringify(prop.defaultValue) : getExampleValueForType(prop.type)}}`)
  .join(' ')} />`;
                
                case 'molecule':
                  return `import { ${component.name} } from "${component.importPath || '@components/molecules'}";

// Example usage with required props
<${component.name} ${Object.entries(component.properties || {})
  .filter(([_, prop]: [string, any]) => prop.required)
  .slice(0, 3) // Limit to first 3 properties for readability
  .map(([key, prop]: [string, any]) => `${key}={${prop.defaultValue !== undefined ? JSON.stringify(prop.defaultValue) : getExampleValueForType(prop.type)}}`)
  .join(' ')} />`;
                
                case 'widget':
                  return `// Widget: ${component.name}
{
  "widgetType": "${component.type || 'CUSTOM_WIDGET'}",
  "id": "${component.name.toLowerCase().replace(/\s+/g, '-')}",
  "properties": {
    ${Object.entries(component.properties || {})
      .slice(0, 3) // Limit to first 3 properties for readability
      .map(([key, prop]: [string, any]) => `"${key}": ${prop.defaultValue !== undefined ? JSON.stringify(prop.defaultValue) : getExampleValueForType(prop.type)}`)
      .join(',\n    ')}
  }
}`;
                
                default:
                  return `// No snippet available for ${component.name}`;
              }
            } catch (error) {
              return `// Error generating snippet: ${error}`;
            }
          }
          
          // Helper function to get example values for different property types
          function getExampleValueForType(type: string): string {
            switch (type.toLowerCase()) {
              case 'string':
                return '"example"';
              case 'number':
                return '42';
              case 'boolean':
                return 'true';
              case 'array':
                return '[]';
              case 'object':
                return '{}';
              case 'function':
                return '() => {}';
              case 'node':
              case 'element':
              case 'reactnode':
                return '<div>Example</div>';
              default:
                return '{}';
            }
          }
          
          // Helper function to check if component's properties match the property search query
          function matchesPropertySearch(component: any, propertySearchQuery: string): { match: boolean; properties: string[] } {
            if (!propertySearchQuery || !component.properties) return { match: false, properties: [] };
            
            const propertyMatches: string[] = [];
            const searchTerms = propertySearchQuery.toLowerCase().split(',').map(term => term.trim());
            
            for (const [key, prop] of Object.entries(component.properties)) {
              for (const term of searchTerms) {
                if (key.toLowerCase().includes(term) || 
                    (prop as any).description?.toLowerCase().includes(term) ||
                    (prop as any).type?.toLowerCase().includes(term)) {
                  propertyMatches.push(key);
                  break;
                }
              }
            }
            
            return { match: propertyMatches.length > 0, properties: propertyMatches };
          }
          
          if (type === "atomic" || type === "all") {
            const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
            
            // Gather usage statistics for popularity if needed
            if (includePopularity) {
              // Count usage in molecules
              const moleculeData = JSON.parse(fs.readFileSync(MOLECULE_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
              moleculeData.components.forEach((molecule: Component) => {
                (molecule.atomicDependencies || []).forEach(dep => {
                  componentUsage.set(dep, (componentUsage.get(dep) || 0) + 1);
                });
              });
              
              // Count usage in widgets
              const widgetFiles = fs.readdirSync(WIDGETS_DIR).filter(file => file.endsWith(".json"));
              for (const file of widgetFiles) {
                try {
                  const filePath = path.join(WIDGETS_DIR, file);
                  const content = fs.readFileSync(filePath, 'utf-8');
                  
                  atomicData.components.forEach(component => {
                    if (content.includes(`"${component.name}"`) || content.includes(`'${component.name}'`)) {
                      componentUsage.set(component.name, (componentUsage.get(component.name) || 0) + 1);
                    }
                  });
                } catch (e) {
                  // Ignore file reading errors
                }
              }
            }
            
            atomicData.components.forEach((component: Component) => {
              let includeComponent = false;
              let matchScore = 0;
              
              if (fuzzyMatch) {
                // Use fuzzy matching for component name and description
                const nameMatch = performFuzzyMatch(component.name, searchTerm);
                const descMatch = performFuzzyMatch(component.description, searchTerm);
                
                if (nameMatch.match || descMatch.match) {
                  includeComponent = true;
                  matchScore = Math.max(nameMatch.score, descMatch.score * 0.8); // Name matches are weighted higher
                }
              } else {
                // Use basic includes matching
                if (
                  component.name.toLowerCase().includes(searchTerm) ||
                  component.description.toLowerCase().includes(searchTerm) ||
                  Object.keys(component.properties || {}).some(prop => prop.toLowerCase().includes(searchTerm))
                ) {
                  includeComponent = true;
                }
              }
              
              // Check property-based search
              const propertyMatch = propertySearch 
                ? matchesPropertySearch(component, propertySearch)
                : { match: false, properties: [] };
                
              if (propertySearch && propertyMatch.match) {
                includeComponent = true;
              }
              
              if (includeComponent) {
                const result: any = {
                  type: "atomic",
                  name: component.name,
                  description: component.description,
                  category: component.category,
                  matchScore: matchScore
                };
                
                // Add popularity metrics if requested
                if (includePopularity) {
                  const usageCount = componentUsage.get(component.name) || 0;
                  const totalComponents = atomicData.components.length;
                  result.usageCount = usageCount;
                  result.popularity = usageCount > 0 ? usageCount / totalComponents : 0;
                }
                
                // Add code snippet if requested
                if (includeSnippets) {
                  result.codeSnippet = generateSnippet(component, "atomic");
                }
                
                // Add matched properties if there are any
                if (propertyMatch.properties.length > 0) {
                  result.matchedProperties = propertyMatch.properties;
                }
                
                results.push(result);
              }
            });
          }
          
          if (type === "molecule" || type === "all") {
            const moleculeData = JSON.parse(fs.readFileSync(MOLECULE_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
            
            // Gather usage statistics for popularity if needed
            if (includePopularity) {
              // Count usage in widgets
              const widgetFiles = fs.readdirSync(WIDGETS_DIR).filter(file => file.endsWith(".json"));
              for (const file of widgetFiles) {
                try {
                  const filePath = path.join(WIDGETS_DIR, file);
                  const content = fs.readFileSync(filePath, 'utf-8');
                  
                  moleculeData.components.forEach(component => {
                    if (content.includes(`"${component.name}"`) || content.includes(`'${component.name}'`)) {
                      componentUsage.set(component.name, (componentUsage.get(component.name) || 0) + 1);
                    }
                  });
                } catch (e) {
                  // Ignore file reading errors
                }
              }
            }
            
            moleculeData.components.forEach((component: Component) => {
              let includeComponent = false;
              let matchScore = 0;
              
              if (fuzzyMatch) {
                // Use fuzzy matching for component name and description
                const nameMatch = performFuzzyMatch(component.name, searchTerm);
                const descMatch = performFuzzyMatch(component.description, searchTerm);
                const atomicDepsMatches = (component.atomicDependencies || []).map(dep => 
                  performFuzzyMatch(dep, searchTerm)
                );
                
                const bestAtomicMatch = atomicDepsMatches.length > 0 
                  ? atomicDepsMatches.reduce((best, current) => 
                      current.score > best.score ? current : best, { match: false, score: 0 }) 
                  : { match: false, score: 0 };
                
                if (nameMatch.match || descMatch.match || bestAtomicMatch.match) {
                  includeComponent = true;
                  matchScore = Math.max(
                    nameMatch.score, 
                    descMatch.score * 0.8,
                    bestAtomicMatch.score * 0.6
                  );
                }
              } else {
                // Use basic includes matching
                if (
                  component.name.toLowerCase().includes(searchTerm) ||
                  component.description.toLowerCase().includes(searchTerm) ||
                  Object.keys(component.properties || {}).some(prop => prop.toLowerCase().includes(searchTerm)) ||
                  (component.atomicDependencies && 
                    component.atomicDependencies.some(dep => dep.toLowerCase().includes(searchTerm)))
                ) {
                  includeComponent = true;
                }
              }
              
              // Check property-based search
              const propertyMatch = propertySearch 
                ? matchesPropertySearch(component, propertySearch)
                : { match: false, properties: [] };
                
              if (propertySearch && propertyMatch.match) {
                includeComponent = true;
              }
              
              if (includeComponent) {
                const result: any = {
                  type: "molecule",
                  name: component.name,
                  description: component.description,
                  category: component.category,
                  matchScore: matchScore
                };
                
                // Add popularity metrics if requested
                if (includePopularity) {
                  const usageCount = componentUsage.get(component.name) || 0;
                  const totalComponents = moleculeData.components.length;
                  result.usageCount = usageCount;
                  result.popularity = usageCount > 0 ? usageCount / totalComponents : 0;
                }
                
                // Add code snippet if requested
                if (includeSnippets) {
                  result.codeSnippet = generateSnippet(component, "molecule");
                }
                
                // Add matched properties if there are any
                if (propertyMatch.properties.length > 0) {
                  result.matchedProperties = propertyMatch.properties;
                }
                
                results.push(result);
              }
            });
          }
          
          if (type === "widget" || type === "all") {
            const widgetFiles = fs.readdirSync(WIDGETS_DIR)
              .filter(file => file.endsWith(".json"));
            
            // Gather usage statistics for popularity if needed
            if (includePopularity) {
              // Count widget usage from audit logs or any tracking data if available
              // For demonstration, we'll use file modification time as a proxy for popularity
              for (const file of widgetFiles) {
                try {
                  const filePath = path.join(WIDGETS_DIR, file);
                  const stats = fs.statSync(filePath);
                  const widgetName = file.replace('.json', '');
                  
                  // Recent modifications get higher usage score (simple proxy)
                  const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
                  const usageScore = Math.max(1, 30 - ageInDays); // Higher for more recent changes
                  
                  componentUsage.set(widgetName, usageScore);
                } catch (e) {
                  // Ignore file stats errors
                }
              }
            }
            
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
                  
                  let includeWidget = false;
                  let matchScore = 0;
                  
                  if (fuzzyMatch) {
                    // Use fuzzy matching for widget name and description
                    const nameMatch = performFuzzyMatch(widgetName, searchTerm);
                    const descMatch = performFuzzyMatch(description, searchTerm);
                    
                    if (nameMatch.match || descMatch.match) {
                      includeWidget = true;
                      matchScore = Math.max(nameMatch.score, descMatch.score * 0.8);
                    }
                    
                    // Also check property names with fuzzy matching
                    if (widgetData.properties?.widgetData?.properties) {
                      const propMatches = Object.keys(widgetData.properties.widgetData.properties).map(prop => 
                        performFuzzyMatch(prop, searchTerm)
                      );
                      
                      const bestPropMatch = propMatches.length > 0 
                        ? propMatches.reduce((best, current) => 
                            current.score > best.score ? current : best, { match: false, score: 0 }) 
                        : { match: false, score: 0 };
                        
                      if (bestPropMatch.match) {
                        includeWidget = true;
                        matchScore = Math.max(matchScore, bestPropMatch.score * 0.7);
                      }
                    }
                  } else {
                    // Use basic includes matching
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
                      includeWidget = true;
                    }
                  }
                  
                  // Check property-based search
                  const propertyMatch = propertySearch && widgetData.properties?.widgetData?.properties
                    ? matchesPropertySearch({ properties: widgetData.properties.widgetData.properties }, propertySearch)
                    : { match: false, properties: [] };
                    
                  if (propertySearch && propertyMatch.match) {
                    includeWidget = true;
                  }
                  
                  if (includeWidget) {
                    const result: any = {
                      type: "widget",
                      name: widgetName,
                      description: description,
                      category: category,
                      file: file,
                      matchScore: matchScore
                    };
                    
                    // Add popularity metrics if requested
                    if (includePopularity) {
                      const usageScore = componentUsage.get(widgetName) || 0;
                      const maxScore = Math.max(...Array.from(componentUsage.values()));
                      result.usageCount = usageScore;
                      result.popularity = maxScore > 0 ? usageScore / maxScore : 0;
                    }
                    
                    // Add code snippet if requested
                    if (includeSnippets) {
                      result.codeSnippet = generateSnippet({
                        name: widgetName,
                        type: widgetData.type,
                        properties: widgetData.properties?.widgetData?.properties
                      }, "widget");
                    }
                    
                    // Add matched properties if there are any
                    if (propertyMatch.properties.length > 0) {
                      result.matchedProperties = propertyMatch.properties;
                    }
                    
                    results.push(result);
                  }
                } else if (Array.isArray(widgetData.widgets)) {
                  // Legacy format with widgets array
                  widgetData.widgets.forEach((widget: Widget) => {
                    let includeWidget = false;
                    let matchScore = 0;
                    
                    if (fuzzyMatch) {
                      // Use fuzzy matching for widget name and description
                      const nameMatch = performFuzzyMatch(widget.name, searchTerm);
                      const descMatch = performFuzzyMatch(widget.description, searchTerm);
                      
                      if (nameMatch.match || descMatch.match) {
                        includeWidget = true;
                        matchScore = Math.max(nameMatch.score, descMatch.score * 0.8);
                      }
                      
                      // Also check property names with fuzzy matching
                      if (widget.properties) {
                        const propMatches = Object.keys(widget.properties).map(prop => 
                          performFuzzyMatch(prop, searchTerm)
                        );
                        
                        const bestPropMatch = propMatches.length > 0 
                          ? propMatches.reduce((best, current) => 
                              current.score > best.score ? current : best, { match: false, score: 0 }) 
                          : { match: false, score: 0 };
                          
                        if (bestPropMatch.match) {
                          includeWidget = true;
                          matchScore = Math.max(matchScore, bestPropMatch.score * 0.7);
                        }
                      }
                    } else {
                      // Use basic includes matching
                      if (
                        widget.name.toLowerCase().includes(searchTerm) ||
                        widget.description.toLowerCase().includes(searchTerm) ||
                        Object.keys(widget.properties || {}).some(prop => prop.toLowerCase().includes(searchTerm))
                      ) {
                        includeWidget = true;
                      }
                    }
                    
                    // Check property-based search
                    const propertyMatch = propertySearch && widget.properties
                      ? matchesPropertySearch({ properties: widget.properties }, propertySearch)
                      : { match: false, properties: [] };
                      
                    if (propertySearch && propertyMatch.match) {
                      includeWidget = true;
                    }
                    
                    if (includeWidget) {
                      const result: any = {
                        type: "widget",
                        name: widget.name,
                        description: widget.description,
                        category: widget.category,
                        file: file,
                        matchScore: matchScore
                      };
                      
                      // Add popularity metrics if requested
                      if (includePopularity) {
                        const usageScore = componentUsage.get(widget.name) || 0;
                        const maxScore = Math.max(...Array.from(componentUsage.values()));
                        result.usageCount = usageScore;
                        result.popularity = maxScore > 0 ? usageScore / maxScore : 0;
                      }
                      
                      // Add code snippet if requested
                      if (includeSnippets) {
                        result.codeSnippet = generateSnippet({
                          name: widget.name,
                          type: widget.type,
                          properties: widget.properties
                        }, "widget");
                      }
                      
                      // Add matched properties if there are any
                      if (propertyMatch.properties.length > 0) {
                        result.matchedProperties = propertyMatch.properties;
                      }
                      
                      results.push(result);
                    }
                  });
                }
              } catch (e) {
                console.warn(`Error searching widget file ${file}:`, e);
              }
            }
          }
          
          // Sort results by match score if using fuzzy search
          if (fuzzyMatch) {
            results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
          }
          
          // If popularity is included, provide ordering options based on popularity as well
          if (includePopularity) {
            const resultsByPopularity = [...results].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  results,
                  resultsByPopularity: resultsByPopularity.slice(0, 10), // Top 10 by popularity
                  totalResults: results.length,
                  searchOptions: {
                    fuzzyMatch,
                    propertySearch: propertySearch || null,
                    includeSnippets,
                    includePopularity
                  }
                }, null, 2)
              }]
            };
          }
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                results,
                totalResults: results.length,
                searchOptions: {
                  fuzzyMatch,
                  propertySearch: propertySearch || null,
                  includeSnippets,
                  includePopularity
                }
              }, null, 2)
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
      async ({ componentName, componentType }: { componentName: string; componentType: string }) => {
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
                  
                  // Get exampleJson for this widget using the helper function
                  let widgetExampleJson = readWidgetExampleJson(componentName);
                  
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
                        
                        // Extract exampleJson directly from the widget file if available
                        if (widgetData.exampleJson) {
                          widgetExampleJson = widgetData.exampleJson;
                        }
                        break;
                      }
                      
                      // Also check legacy format with widgets array
                      if (Array.isArray(widgetData.widgets)) {
                        const widget = widgetData.widgets.find((w: Widget) => w.name === componentName);
                        
                        if (widget) {
                          targetWidget = widget;
                          widgetFile = file;
                          
                          // Check if there's an exampleJson at widget level
                          if (widget.exampleJson) {
                            widgetExampleJson = widget.exampleJson;
                          } else if (widgetData.exampleJson) {
                            // Fallback to file level exampleJson
                            widgetExampleJson = widgetData.exampleJson;
                          }
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
                    const widgetData = JSON.parse(content);
                    
                    // Extract exampleJson from the widget file if not already set
                    if (!widgetExampleJson && widgetData.exampleJson) {
                      widgetExampleJson = widgetData.exampleJson;
                    }
                    
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
                          file: widgetFile,
                          exampleJson: widgetExampleJson  // Include exampleJson in response
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
      async ({ category }: { category: string }) => {
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
      async ({ widgetName, widgetType, layout, header, sliderConfig, mediaItems }: { 
        widgetName: string; 
        widgetType: string; 
        layout?: any; 
        header?: any; 
        sliderConfig?: any; 
        mediaItems?: any[]
      }) => {
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
          let enhancedConfig;
          
          if (fs.existsSync(widgetSpecPath)) {
            // If widget spec exists, use it as template
            const widgetSpec = JSON.parse(fs.readFileSync(widgetSpecPath, 'utf-8'));
            
            // Check if the widget has an exampleJson we can use as a starting point
            if (widgetSpec.exampleJson) {
              // Use example as the basis, but ensure it has the correct ID and custom configurations
              enhancedConfig = {
                ...widgetSpec.exampleJson,
                id: baseConfig.id,
                ...(header && { header: { ...widgetSpec.exampleJson.header, ...header } }),
                ...(layout && { layout: { ...widgetSpec.exampleJson.layout, ...layout } })
              };
              
              // Handle specific overrides for the widget data
              if (mediaItems || sliderConfig) {
                enhancedConfig.widgetData = {
                  ...enhancedConfig.widgetData,
                  ...(mediaItems && { items: mediaItems.map((media: any) => ({ media })) }),
                  ...(sliderConfig && { sliderConfig })
                };
              }
            } else {
              // No example, use standard approach
              widgetData = {
                ...widgetSpec.widgetData,
                // Override with provided values if any
                ...(mediaItems && { items: mediaItems.map((media: any) => ({ media })) }),
                ...(sliderConfig && { sliderConfig })
              };
              
              // Create the config based on the base config and widget data
              enhancedConfig = {
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
            }
          } else {
            // For new widgets, provide base structure
            widgetData = {
              content: "Widget content goes here",
              settings: {
                showBorder: false
              }
            };
            
            // Create the config based on the base config and widget data
            enhancedConfig = {
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
          }

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
      "getWidgetBaseConfig",
      {
        widgetName: z.string().min(3),
        widgetType: z.string(),
        category: z.enum(['product', 'media', 'layout', 'information', 'navigation', 'social', 'content']).default('information'),
        description: z.string().optional(),
        layoutType: z.enum(['CONTAINED', 'FLUID']).optional().default('FLUID'),
        verticalSpacingTop: z.enum(['NONE', 'COMPACT', 'GENEROUS']).optional().default('COMPACT'),
        verticalSpacingBottom: z.enum(['NONE', 'COMPACT', 'GENEROUS']).optional().default('COMPACT')
      },
      async ({ widgetName, widgetType, category, description, layoutType = 'FLUID', verticalSpacingTop = 'COMPACT', verticalSpacingBottom = 'COMPACT' }: {
        widgetName: string;
        widgetType: string;
        category: string;
        description?: string;
        layoutType?: string;
        verticalSpacingTop?: string;
        verticalSpacingBottom?: string;
      }) => {
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
              
            case 'content':
              baseConfig.widgetData = {
                title: 'Main Content Title',
                sections: [
                  {
                    heading: 'Section Heading',
                    content: 'This is the main content text that provides valuable information to the reader.',
                    mediaPosition: 'right',
                    media: {
                      mediaType: 'image',
                      source: 'https://example.com/image1.jpg',
                      altText: 'Example image',
                      loading: 'lazy'
                    }
                  }
                ],
                settings: {
                  showBorder: false,
                  backgroundColor: '#f7f7f7',
                  textAlignment: 'left'
                }
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
      async ({ widgetName, widgetType }: { widgetName: string; widgetType: string }) => {
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
      async ({ includeDetails = false }: { includeDetails?: boolean }) => {
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

    this.server.tool(
      "listThemeVariables",
      {
        variableType: z.enum(["color", "size", "font", "typography", "spacing", "layout", "all"]).optional().default("all"),
        groupBy: z.enum(["prefix", "none"]).optional().default("prefix"),
        // Optional: Add a parameter for the theme file path if it's not constant
        // themeFilePath: z.string().optional() 
      },
      async ({ variableType = "all", groupBy = "prefix" }: { 
        variableType?: string; 
        groupBy?: string;
        // themeFilePath?: string;
      }) => {
        try {
          const themeSpecPath = path.resolve(COMPONENT_SPEC_DIR, 'theme-variables.json');
          
          if (!fs.existsSync(themeSpecPath)) {
             throw new Error(`Theme specification file not found at: ${themeSpecPath}`);
           }

          const specContent = fs.readFileSync(themeSpecPath, "utf-8");
          const themeSpec = JSON.parse(specContent);

          if (!themeSpec || !Array.isArray(themeSpec.variables)) {
             throw new Error(`Invalid format in theme specification file: ${themeSpecPath}`);
          }

          const allVariables: { name: string; inferredType: string; prefix: string }[] = themeSpec.variables;

          // Filter variables based on type requested by the user
          const filteredVariables = allVariables.filter(variable => {
            if (variableType === "all") return true;
            // Use the inferredType from the JSON spec for filtering
            if (variableType === "color") return variable.inferredType === "color";
            if (variableType === "size") return variable.inferredType === "size";
            if (variableType === "font") return variable.inferredType === "font";
            if (variableType === "typography") return variable.inferredType === "typography";
            if (variableType === "spacing") return variable.inferredType === "spacing";
            if (variableType === "layout") return variable.inferredType === "layout";
            // Add more types here if needed
            return variable.inferredType === variableType; // Allow filtering by other inferred types
          });

          let resultData: any;

          if (groupBy === "prefix") {
            const groupedVariables: Record<string, string[]> = {};
            filteredVariables.forEach(variable => {
              // Use the prefix from the JSON spec for grouping
              const prefix = variable.prefix || "other"; 
              if (!groupedVariables[prefix]) {
                groupedVariables[prefix] = [];
              }
              groupedVariables[prefix].push(variable.name);
            });
            resultData = groupedVariables;
          } else {
            // Return flat list of names if no grouping
            resultData = filteredVariables.map(v => v.name);
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                variableTypeFilter: variableType,
                grouping: groupBy,
                variables: resultData,
                sourceFile: themeSpecPath // Point to the JSON spec file now
              }, null, 2)
            }]
          };

        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Failed to list theme variables: ${errorMessage}`
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

function readWidgetExampleJson(widgetName: string): any {
  try {
    // Convert widget name to kebab case for file lookup
    const widgetFileName = `${widgetName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}-widget.json`;
    const widgetPath = path.join(WIDGETS_DIR, widgetFileName);
    
    if (fs.existsSync(widgetPath)) {
      const content = fs.readFileSync(widgetPath, 'utf-8');
      const widgetData = JSON.parse(content);
      return widgetData.exampleJson || null;
    }
  } catch (e) {
    console.warn(`Error reading exampleJson for widget ${widgetName}:`, e);
  }
  return null;
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
