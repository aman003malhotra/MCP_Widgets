/**
 * PWA Component Specification MCP
 * 
 * This file defines the interfaces for interacting with the PWA Component Specification MCP.
 * The MCP provides access to atomic components and widgets defined in the component-spec folder.
 */

// Component Prop Type
export interface ComponentProp {
  type: string;
  description?: string;
  required?: boolean;
  defaultValue?: any;
  options?: any[];
  subProps?: Record<string, any>;
}

// Atomic Component Type
export interface Component {
  name: string;
  description: string;
  type: string;
  category: string;
  properties: Record<string, ComponentProp>;
  styles?: Record<string, any>;
  variantStyles?: Record<string, any>;
  atomicDependencies?: string[]; // List of atomic components this component depends on
  relativePath?: string; // Path relative to the project root
  importPath?: string; // Import path for the component
}

// Widget Type
export interface Widget {
  name: string;
  description: string;
  type: string;
  category: string;
  version: string;
  properties: Record<string, ComponentProp>;
}

// Atomic Components Data
export interface AtomicComponentsData {
  components: Component[];
}

// Widget Data
export interface WidgetData {
  widgets: Widget[];
}

// Component Search Result
export interface ComponentSearchResult {
  type: "atomic" | "molecule" | "widget";
  name: string;
  description: string;
  category: string;
  file?: string;
}

/**
 * Resources
 * 
 * /components/atomic - Get all atomic components
 * /components/widgets - Get all widgets
 * /components/widgets/:widgetName - Get a specific widget by name
 */

/**
 * Tools
 * 
 * searchComponents - Search for components by name, description, or properties
 *   Parameters:
 *     - query: string - Search term
 *     - type: "atomic" | "molecule" | "widget" | "all" - Type of components to search
 *   Returns:
 *     - results: ComponentSearchResult[] - Array of matching components
 * 
 * getComponentProperties - Get detailed properties of a specific component
 *   Parameters:
 *     - componentName: string - Name of the component
 *     - componentType: "atomic" | "molecule" | "widget" - Type of the component
 *   Returns:
 *     - For atomic components: Component details, usage in molecules/widgets, similar components
 *     - For molecules: Component details, atomic dependencies, widgets using this molecule
 *     - For widgets: Component details, atomic/molecule dependencies, similar widgets
 * 
 * getComponentLibrary - Get comprehensive information about all available components
 *   Parameters:
 *     - includeDetails: boolean (optional, default: false) - Whether to include additional relationship information and advanced recommendations
 *   Returns:
 *     - summary: Overview counts of components by type
 *     - components: Lists of all atomic, molecular, and widget components (without detailed properties)
 *     - categorized: Components grouped by category
 *     - stats: Statistical information about the component library
 *     - relationships: How components relate to each other (only if includeDetails=true)
 *     - recommendations: Suggested popular and complementary components (extended if includeDetails=true)
 */
