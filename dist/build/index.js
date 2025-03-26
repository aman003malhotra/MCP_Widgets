import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
// Define paths to component specs
const COMPONENT_SPEC_DIR = path.resolve(process.cwd(), "component-spec");
const ATOMIC_COMPONENTS_PATH = path.resolve(COMPONENT_SPEC_DIR, "atomic-components.json");
const WIDGETS_DIR = path.resolve(COMPONENT_SPEC_DIR, "widgets");
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
    props: z.record(ComponentPropSchema),
    styles: z.record(z.any()).optional(),
    variantStyles: z.record(z.any()).optional(),
});
const WidgetSchema = z.object({
    name: z.string(),
    description: z.string(),
    type: z.string(),
    category: z.string(),
    version: z.string(),
    props: z.record(ComponentPropSchema),
});
// Create server instance
const server = new McpServer({
    name: "pwa-component-spec",
    version: "1.0.0",
    capabilities: {
        resources: {
            // Atomic components resource
            "/components/atomic": {
                get: async () => {
                    try {
                        const data = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8"));
                        return { body: data };
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        return {
                            status: 500,
                            body: { error: `Failed to load atomic components: ${errorMessage}` }
                        };
                    }
                },
            },
            // Widget component resource
            "/components/widgets": {
                get: async () => {
                    try {
                        const widgetFiles = fs.readdirSync(WIDGETS_DIR)
                            .filter(file => file.endsWith(".json"));
                        const widgets = {};
                        for (const file of widgetFiles) {
                            const filePath = path.join(WIDGETS_DIR, file);
                            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                            const widgetName = file.replace(".json", "");
                            widgets[widgetName] = data;
                        }
                        return { body: widgets };
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        return {
                            status: 500,
                            body: { error: `Failed to load widgets: ${errorMessage}` }
                        };
                    }
                },
            },
            // Single widget resource with parameter
            "/components/widgets/:widgetName": {
                get: async (req) => {
                    try {
                        const { widgetName } = req.params;
                        const filePath = path.join(WIDGETS_DIR, `${widgetName}.json`);
                        if (!fs.existsSync(filePath)) {
                            return {
                                status: 404,
                                body: { error: `Widget '${widgetName}' not found` }
                            };
                        }
                        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                        return { body: data };
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        return {
                            status: 500,
                            body: { error: `Failed to load widget: ${errorMessage}` }
                        };
                    }
                },
            },
        },
        tools: {
            // Tool to search for components by name or properties
            searchComponents: {
                description: "Search for UI components by name, description, or properties",
                parameters: z.object({
                    query: z.string().describe("Search term to find in component names, descriptions, or props"),
                    type: z.enum(["atomic", "widget", "all"]).default("all").describe("Type of components to search"),
                }),
                handler: async ({ query, type }) => {
                    try {
                        const results = [];
                        const searchTerm = query.toLowerCase();
                        // Search atomic components if requested
                        if (type === "atomic" || type === "all") {
                            const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8"));
                            atomicData.components.forEach((component) => {
                                if (component.name.toLowerCase().includes(searchTerm) ||
                                    component.description.toLowerCase().includes(searchTerm) ||
                                    Object.keys(component.props).some(prop => prop.toLowerCase().includes(searchTerm))) {
                                    results.push({
                                        type: "atomic",
                                        name: component.name,
                                        description: component.description,
                                        category: component.category,
                                    });
                                }
                            });
                        }
                        // Search widgets if requested
                        if (type === "widget" || type === "all") {
                            const widgetFiles = fs.readdirSync(WIDGETS_DIR)
                                .filter(file => file.endsWith(".json"));
                            for (const file of widgetFiles) {
                                const filePath = path.join(WIDGETS_DIR, file);
                                const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                                if (Array.isArray(widgetData.widgets)) {
                                    widgetData.widgets.forEach((widget) => {
                                        if (widget.name.toLowerCase().includes(searchTerm) ||
                                            widget.description.toLowerCase().includes(searchTerm) ||
                                            Object.keys(widget.props).some(prop => prop.toLowerCase().includes(searchTerm))) {
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
                            }
                        }
                        return { results };
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        throw new Error(`Search failed: ${errorMessage}`);
                    }
                },
            },
            // Tool to get component properties
            getComponentProperties: {
                description: "Get detailed properties of a specific component",
                parameters: z.object({
                    componentName: z.string().describe("Name of the component to get properties for"),
                    componentType: z.enum(["atomic", "widget"]).describe("Type of the component"),
                }),
                handler: async ({ componentName, componentType }) => {
                    try {
                        if (componentType === "atomic") {
                            const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8"));
                            const component = atomicData.components.find((c) => c.name === componentName);
                            if (!component) {
                                throw new Error(`Atomic component '${componentName}' not found`);
                            }
                            return { properties: component.props };
                        }
                        else {
                            // For widgets, search in all widget files
                            const widgetFiles = fs.readdirSync(WIDGETS_DIR)
                                .filter(file => file.endsWith(".json"));
                            for (const file of widgetFiles) {
                                const filePath = path.join(WIDGETS_DIR, file);
                                const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                                if (Array.isArray(widgetData.widgets)) {
                                    const widget = widgetData.widgets.find((w) => w.name === componentName);
                                    if (widget) {
                                        return { properties: widget.props };
                                    }
                                }
                            }
                            throw new Error(`Widget '${componentName}' not found`);
                        }
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        throw new Error(`Failed to get properties: ${errorMessage}`);
                    }
                },
            },
        },
    },
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Component Spec MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
