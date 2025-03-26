/**
 * PWA Component Specification MCP
 *
 * This file defines the interfaces for interacting with the PWA Component Specification MCP.
 * The MCP provides access to atomic components and widgets defined in the component-spec folder.
 */
export {};
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
