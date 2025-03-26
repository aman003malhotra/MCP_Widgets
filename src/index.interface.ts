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
  props: Record<string, ComponentProp>;
  styles?: Record<string, any>;
  variantStyles?: Record<string, any>;
}

// Widget Type
export interface Widget {
  name: string;
  description: string;
  type: string;
  category: string;
  version: string;
  props: Record<string, ComponentProp>;
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
  type: "atomic" | "widget";
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
 *     - type: "atomic" | "widget" | "all" - Type of components to search
 *   Returns:
 *     - results: ComponentSearchResult[] - Array of matching components
 * 
 * getComponentProperties - Get detailed properties of a specific component
 *   Parameters:
 *     - componentName: string - Name of the component
 *     - componentType: "atomic" | "widget" - Type of the component
 *   Returns:
 *     - properties: Record<string, ComponentProp> - Component properties
 */
