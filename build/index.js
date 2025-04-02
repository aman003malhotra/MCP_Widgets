import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import cors from "cors";
import { BASE_WIDGET_MAP_TYPES } from "./WidgetMap.js";
import { FigmaComponentInputSchema } from './FigmaSchemas.js';
// Define paths to component specs
const COMPONENT_SPEC_DIR = path.resolve(process.cwd(), "component-spec");
const ATOMIC_COMPONENTS_PATH = path.resolve(COMPONENT_SPEC_DIR, "atomic-components.json");
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
    sseTransport = null;
    server;
    constructor() {
        this.server = new McpServer({
            name: "pwa-component-spec",
            version: "1.0.0"
        });
        // Register resources
        this.server.resource("atomic-components", "components://atomic", async () => {
            try {
                const data = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8"));
                return {
                    contents: [{
                            uri: "components://atomic",
                            text: JSON.stringify(data, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to load atomic components: ${errorMessage}`);
            }
        });
        this.server.resource("widgets", "components://widgets", async () => {
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
                return {
                    contents: [{
                            uri: "components://widgets",
                            text: JSON.stringify(widgets, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to load widgets: ${errorMessage}`);
            }
        });
        this.server.resource("widget", new ResourceTemplate("components://widgets/{widgetName}", { list: undefined }), async (uri, { widgetName }) => {
            try {
                const filePath = path.join(WIDGETS_DIR, `${widgetName}.json`);
                if (!fs.existsSync(filePath)) {
                    throw new Error(`Widget '${widgetName}' not found`);
                }
                const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                return {
                    contents: [{
                            uri: uri.href,
                            text: JSON.stringify(data, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to load widget: ${errorMessage}`);
            }
        });
        // Register tools
        this.server.tool("searchComponents", {
            query: z.string(),
            type: z.enum(["atomic", "widget", "all"]).default("all")
        }, async ({ query, type }) => {
            try {
                const results = [];
                const searchTerm = query.toLowerCase();
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
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(results, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Search failed: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("getComponentProperties", {
            componentName: z.string(),
            componentType: z.enum(["atomic", "widget"])
        }, async ({ componentName, componentType }) => {
            try {
                if (componentType === "atomic") {
                    const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8"));
                    const component = atomicData.components.find((c) => c.name === componentName);
                    if (!component) {
                        throw new Error(`Atomic component '${componentName}' not found`);
                    }
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify(component.props, null, 2)
                            }]
                    };
                }
                else {
                    const widgetFiles = fs.readdirSync(WIDGETS_DIR)
                        .filter(file => file.endsWith(".json"));
                    for (const file of widgetFiles) {
                        const filePath = path.join(WIDGETS_DIR, file);
                        const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                        if (Array.isArray(widgetData.widgets)) {
                            const widget = widgetData.widgets.find((w) => w.name === componentName);
                            if (widget) {
                                return {
                                    content: [{
                                            type: "text",
                                            text: JSON.stringify(widget.props, null, 2)
                                        }]
                                };
                            }
                        }
                    }
                    throw new Error(`Widget '${componentName}' not found`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Failed to get properties: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("getWidgetMap", {
            category: z.enum(['all', 'media', 'product', 'layout', 'social']).optional().default('all')
        }, async ({ category }) => {
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
                    }
                    catch (error) {
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
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Failed to get widget map: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        // Add new tools after existing tools
        this.server.tool("createWidgetConfig", {
            widgetName: z.string(),
            widgetType: z.enum(Object.values(BASE_WIDGET_MAP_TYPES)),
            layout: LayoutConfigSchema.optional(),
            header: HeaderConfigSchema.optional(),
            sliderConfig: SliderConfigSchema.optional(),
            mediaItems: z.array(MediaConfigSchema).optional()
        }, async ({ widgetName, widgetType, layout, header, sliderConfig, mediaItems }) => {
            try {
                const widgetConfig = {
                    name: widgetName,
                    widgets: [
                        {
                            type: widgetType,
                            ...(layout && { layout }),
                            ...(header && { header }),
                            ...(sliderConfig || mediaItems) && {
                                widgetData: {
                                    ...(sliderConfig && { sliderConfig }),
                                    showBorder: false,
                                    ...(mediaItems && {
                                        items: mediaItems.map(media => ({ media }))
                                    })
                                }
                            }
                        }
                    ]
                };
                const configPath = path.join(COMPONENT_SPEC_DIR, 'widget-configs', `${widgetName}.json`);
                fs.writeFileSync(configPath, JSON.stringify(widgetConfig, null, 2));
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(widgetConfig, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Failed to create widget config: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("validateWidgetConfig", {
            widgetName: z.string(),
            widgetSpec: z.record(z.any()).optional()
        }, async ({ widgetName, widgetSpec }) => {
            try {
                let config;
                if (widgetSpec) {
                    config = widgetSpec;
                }
                else {
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
                config.widgets.forEach((widget, index) => {
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
                        widget.widgetData.items.forEach((item, itemIndex) => {
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
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Validation failed: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("updateWidgetConfig", {
            widgetName: z.string(),
            updates: z.object({
                layout: LayoutConfigSchema.optional(),
                header: HeaderConfigSchema.optional(),
                sliderConfig: SliderConfigSchema.optional(),
                mediaItems: z.array(MediaConfigSchema).optional()
            })
        }, async ({ widgetName, updates }) => {
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
                if (updates.layout)
                    widget.layout = updates.layout;
                if (updates.header)
                    widget.header = updates.header;
                if (updates.sliderConfig || updates.mediaItems) {
                    widget.widgetData = widget.widgetData || {};
                    if (updates.sliderConfig)
                        widget.widgetData.sliderConfig = updates.sliderConfig;
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
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Failed to update widget config: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("convertFigmaToWidget", {
            figmaInput: FigmaComponentInputSchema
        }, async ({ figmaInput }) => {
            try {
                const { node, componentName } = figmaInput;
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
                }
                else {
                    return {
                        content: [{
                                type: "text",
                                text: `Validation failed: ${validationResult.errors.join(', ')}`
                            }],
                        isError: true
                    };
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: `Failed to convert Figma to widget: ${errorMessage}`
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("generateWidget", {
            name: z.string().min(3),
            type: z.string().min(3),
            description: z.string().min(10),
            category: z.enum(['product', 'media', 'layout', 'information', 'navigation', 'social']),
            version: z.string().default('1.0.0'),
            atomicComponents: z.array(z.string()).min(1)
        }, async (params) => {
            try {
                console.log(`Generating widget spec for: ${params.name}`);
                // First, read atomic-components.json to verify the requested components exist
                const atomicComponentsPath = path.resolve(COMPONENT_SPEC_DIR, "atomic-components.json");
                const atomicComponentsData = JSON.parse(fs.readFileSync(atomicComponentsPath, "utf-8"));
                const availableAtoms = atomicComponentsData.components.map((c) => c.name);
                // Check which requested atoms are available
                const unavailableAtoms = params.atomicComponents.filter(atom => !availableAtoms.includes(atom));
                if (unavailableAtoms.length > 0) {
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    message: `The following atomic components were not found: ${unavailableAtoms.join(', ')}`,
                                    availableAtoms: availableAtoms
                                }, null, 2)
                            }],
                        isError: true
                    };
                }
                // Create widget spec object
                const widgetSpec = {
                    name: params.name,
                    type: params.type,
                    description: params.description,
                    category: params.category,
                    version: params.version,
                    atomicComponents: params.atomicComponents,
                    properties: {
                        widgetData: {
                            type: params.type,
                            description: `Data configuration for ${params.name}`,
                            // Create basic default structure based on category
                            defaultStructure: createDefaultStructureByCategory(params.category)
                        }
                    }
                };
                // Get detailed information about the requested atomic components
                const atomDetails = params.atomicComponents.map(atomName => {
                    const atomComponent = atomicComponentsData.components.find((c) => c.name === atomName);
                    if (!atomComponent)
                        return { name: atomName, note: "Component details not found" };
                    return {
                        name: atomName,
                        description: atomComponent.description || "No description available",
                        props: Object.keys(atomComponent.props || {}).map(propName => ({
                            name: propName,
                            type: atomComponent.props[propName].type,
                            description: atomComponent.props[propName].description,
                            required: atomComponent.props[propName].required
                        }))
                    };
                });
                // Recommend BaseWidgetComponent if not included
                let baseWidgetRecommendation = null;
                if (!params.atomicComponents.includes('BaseWidgetComponent')) {
                    const baseWidgetComp = atomicComponentsData.components.find((c) => c.name === 'BaseWidgetComponent');
                    if (baseWidgetComp) {
                        baseWidgetRecommendation = {
                            name: 'BaseWidgetComponent',
                            description: baseWidgetComp.description || "Base wrapper component for all widgets",
                            importance: "Required as the root wrapper for all widgets"
                        };
                    }
                }
                // Get widget type in consistent format
                const widgetType = widgetSpec.properties?.widgetData?.type || widgetSpec.type;
                const normalizedType = widgetType.toUpperCase().replace(/-/g, '_');
                // Get atomic components from the widget spec
                const atomicComponents = widgetSpec.atomicComponents || [];
                console.log("Widget uses atomic components: " + atomicComponents.join(", "));
                // Check if atomic components exist
                if (atomicComponents.length === 0) {
                    console.warn("No atomic components specified in widget spec");
                }
                // Define valid atomic components based on component-spec/atomic-components.json
                const validAtomicComponents = ["Button", "Typography", "OptimizedImage", "OptimizedVideo"];
                // Check if specified atomic components are valid
                const invalidAtomicComponents = atomicComponents.filter(comp => !validAtomicComponents.includes(comp));
                if (invalidAtomicComponents.length > 0) {
                    console.warn("Invalid atomic components specified: " + invalidAtomicComponents.join(", "));
                    console.warn("Valid atomic components are: " + validAtomicComponents.join(", "));
                }
                // Recommended atomic components based on usage
                const componentUsageMap = {
                    "buttons": ["Button"],
                    "text": ["Typography"],
                    "images": ["OptimizedImage"],
                    "videos": ["OptimizedVideo"]
                };
                // Suggestions for typical widget elements
                const widgetElementSuggestions = {
                    "header": "Use Typography with appropriate heading variant",
                    "body": "Use Typography with BODY_BASE_REGULAR variant",
                    "images": "Use OptimizedImage for responsive, optimized images",
                    "videos": "Use OptimizedVideo for optimized playback and loading",
                    "buttons": "Use Button with appropriate variant and size"
                };
                // Get detailed information about atomic components from atomic-components.json
                let detailedAtomicComponentsData = {};
                try {
                    const atomicComponentsPath = path.resolve(COMPONENT_SPEC_DIR, "atomic-components.json");
                    if (fs.existsSync(atomicComponentsPath)) {
                        const atomicComponentsJson = JSON.parse(fs.readFileSync(atomicComponentsPath, "utf-8"));
                        atomicComponents.forEach((componentName) => {
                            const componentInfo = atomicComponentsJson.components.find((c) => c.name === componentName);
                            if (componentInfo) {
                                detailedAtomicComponentsData[componentName] = {
                                    description: componentInfo.description || "",
                                    props: componentInfo.props || {}
                                };
                            }
                        });
                    }
                }
                catch (atomicError) {
                    console.warn("Failed to load atomic components data: " + atomicError);
                }
                // Check if the widget type exists in the Widget.map.ts
                const widgetMapPath = path.resolve(process.cwd(), "src", "WidgetMap.ts");
                if (fs.existsSync(widgetMapPath)) {
                    const widgetMapContent = fs.readFileSync(widgetMapPath, "utf-8");
                    if (!widgetMapContent.includes(normalizedType + ":")) {
                        console.warn("Widget type " + normalizedType + " not found in Widget.map.ts");
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: "Widget type " + normalizedType + " not found in Widget.map.ts",
                                        suggestedAction: {
                                            tool: "addWidgetToMap",
                                            params: {
                                                widgetName: params.name,
                                                widgetType: widgetType.toUpperCase()
                                            },
                                            description: "Please run addWidgetToMap first to register your widget type"
                                        }
                                    }, null, 2)
                                }],
                            isError: true
                        };
                    }
                }
                // Extract needed variables from params
                const widgetName = params.name;
                const extendedParams = params;
                const clientFramework = extendedParams.clientFramework || 'react';
                const targetDirectory = extendedParams.targetDirectory;
                const includeCodeSnippets = extendedParams.includeCodeSnippets || false;
                // Generate file templates (not actual files)
                const fileTemplates = {};
                // Create paths configuration based on client framework
                const defaultBasePath = "src/mono/web-core/auditedWidgets/" + widgetName;
                const basePath = targetDirectory || defaultBasePath;
                const componentPath = clientFramework === 'next' ? basePath + "/page.tsx" : basePath + "/" + widgetName + ".tsx";
                // Generate all your file templates here
                // 1. Interface file
                fileTemplates["interface"] = {
                    fileName: widgetName + ".interface.ts",
                    content: "import { WidgetProps } from '../../types/WidgetProps';\n\n" +
                        "/**\n * Data structure for the " + widgetName + " widget\n */\n" +
                        "export interface " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Data {\n" +
                        (widgetSpec.properties?.widgetData?.defaultStructure
                            ? "  // Data structure based on widget specification\n" +
                                generateInterfaceFromStructure(widgetSpec.properties.widgetData.defaultStructure)
                            : "  // Add widget-specific data properties here\n" +
                                "  items?: Array<{\n" +
                                "    id?: string;\n" +
                                "    title?: string;\n" +
                                "    description?: string;\n" +
                                "    imageUrl?: string;\n" +
                                "    link?: string;\n" +
                                "  }>;\n" +
                                "  settings?: {\n" +
                                "    columns?: number;\n" +
                                "    showBorder?: boolean;\n" +
                                "    theme?: 'light' | 'dark';\n" +
                                "  };\n") +
                        "}\n\n" +
                        "/**\n * Props for the " + widgetName + " widget component\n */\n" +
                        "export interface " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Props extends WidgetProps {\n" +
                        "  widgetData: " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Data;\n" +
                        "  className?: string;\n" +
                        "  testId?: string;\n" +
                        "}",
                    description: "TypeScript interface definitions for your widget",
                    path: basePath
                };
                // 2. Styles file
                fileTemplates["styles"] = {
                    fileName: widgetName + ".styles.ts",
                    content: "import styled from 'styled-components';\n\n" +
                        "export const " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Container = styled.div`\n" +
                        "  display: flex;\n" +
                        "  flex-direction: column;\n" +
                        "  width: 100%;\n\n" +
                        "  .header {\n" +
                        "    margin-bottom: 24px;\n" +
                        "  }\n\n" +
                        "  .content {\n" +
                        "    display: grid;\n" +
                        "    grid-template-columns: repeat(var(--columns, 3), 1fr);\n" +
                        "    gap: var(--gap, 16px);\n" +
                        "  }\n\n" +
                        "  .item {\n" +
                        "    padding: 16px;\n" +
                        "    border-radius: 8px;\n" +
                        "  }\n\n" +
                        "  .item-image {\n" +
                        "    width: 100%;\n" +
                        "    aspect-ratio: 16/9;\n" +
                        "    object-fit: cover;\n" +
                        "    margin-bottom: 12px;\n" +
                        "  }\n" +
                        "`",
                    description: "Styled-components for your widget",
                    path: basePath
                };
                // 3. Component file
                fileTemplates["component"] = {
                    fileName: componentPath.split('/').pop() || widgetName + ".tsx",
                    content: "import React from 'react';\n" +
                        "import { " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Props } from './" + widgetName + ".interface';\n" +
                        "import { " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Container } from './" + widgetName + ".styles';\n" +
                        // Import atomic components
                        (atomicComponents.length > 0
                            ? atomicComponents
                                .filter(comp => validAtomicComponents.includes(comp))
                                .map((comp) => `import { ${comp} } from '../../atomic-components/${comp}';\n`).join("")
                            : "") +
                        "\n" +
                        "export const " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + ": React.FC<" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Props> = ({\n" +
                        "  widgetData,\n" +
                        "  layout,\n" +
                        "  header,\n" +
                        "  id,\n" +
                        "  className = '',\n" +
                        "  testId = '" + widgetName + "',\n" +
                        "}) => {\n" +
                        "  if (!widgetData) {\n" +
                        "    return null;\n" +
                        "  }\n\n" +
                        "  const settings = {\n" +
                        "    columns: widgetData.settings?.columns || 3,\n" +
                        "    showBorder: widgetData.settings?.showBorder ?? false,\n" +
                        "    theme: widgetData.settings?.theme || 'light'\n" +
                        "  };\n\n" +
                        "  const cssVariables = {\n" +
                        "    '--columns': settings.columns,\n" +
                        "    '--gap': '16px'\n" +
                        "  };\n\n" +
                        "  return (\n" +
                        "    <" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Container \n" +
                        "      className={className}\n" +
                        "      style={cssVariables as React.CSSProperties}\n" +
                        "      data-testid={testId}\n" +
                        "    >\n" +
                        "      {header && (\n" +
                        "        <div className=\"header\">\n" +
                        (atomicComponents.includes("Typography")
                            ? "          {header.title && <Typography variant=\"HEADING_MEDIUM_BOLD\">{header.title}</Typography>}\n" +
                                "          {header.subtitle && <Typography variant=\"BODY_BASE_REGULAR\">{header.subtitle}</Typography>}\n"
                            : "          {header.title && <h2>{header.title}</h2>}\n" +
                                "          {header.subtitle && <p>{header.subtitle}</p>}\n") +
                        "        </div>\n" +
                        "      )}\n" +
                        "      <div className=\"content\">\n" +
                        "        {widgetData.items?.map((item, index) => (\n" +
                        "          <div key={item.id || index} className=\"item\" data-testid={testId + '-item-' + index}>\n" +
                        (atomicComponents.includes("OptimizedImage")
                            ? "            {item.imageUrl && (\n" +
                                "              <OptimizedImage \n" +
                                "                source={item.imageUrl} \n" +
                                "                altText={item.title || ''} \n" +
                                "                desktopViewWidth=\"THIRD\"\n" +
                                "                mobileViewWidth=\"FULL\"\n" +
                                "              />\n" +
                                "            )}\n"
                            : "            {item.imageUrl && (\n" +
                                "              <img src={item.imageUrl} alt={item.title || ''} className=\"item-image\" />\n" +
                                "            )}\n") +
                        (atomicComponents.includes("Typography")
                            ? "            {item.title && <Typography variant=\"HEADING_SMALL_BOLD\">{item.title}</Typography>}\n" +
                                "            {item.description && <Typography variant=\"BODY_BASE_REGULAR\">{item.description}</Typography>}\n"
                            : "            {item.title && (\n" +
                                "              <h3 className=\"item-title\">\n" +
                                "                {item.link ? <a href={item.link}>{item.title}</a> : item.title}\n" +
                                "              </h3>\n" +
                                "            )}\n" +
                                "            {item.description && <p className=\"item-description\">{item.description}</p>}\n") +
                        (atomicComponents.includes("Button")
                            ? "            {item.link && <Button\n" +
                                "              variant=\"PRIMARY\"\n" +
                                "              size=\"MEDIUM\"\n" +
                                "              label=\"Learn More\"\n" +
                                "              onClick={() => window.location.href = item.link || '#'}\n" +
                                "            />}\n"
                            : "") +
                        "          </div>\n" +
                        "        ))}\n" +
                        "        {!widgetData.items?.length && (\n" +
                        (atomicComponents.includes("Typography")
                            ? "          <div className=\"empty-state\" data-testid={testId + '-empty-state'}>\n" +
                                "            <Typography variant=\"BODY_BASE_REGULAR\">No items to display</Typography>\n" +
                                "          </div>\n"
                            : "          <div className=\"empty-state\" data-testid={testId + '-empty-state'}>\n" +
                                "            <p>No items to display</p>\n" +
                                "          </div>\n") +
                        "        )}\n" +
                        "      </div>\n" +
                        "    </" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "Container>\n" +
                        "  );\n" +
                        "};\n\n" +
                        "export default " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + ";",
                    description: "Main React component implementation using atomic components: " +
                        atomicComponents.filter(comp => validAtomicComponents.includes(comp)).join(", "),
                    path: path.dirname(componentPath)
                };
                // 4. Test file
                fileTemplates["test"] = {
                    fileName: widgetName + ".test.tsx",
                    content: "import React from 'react';\n" +
                        "import { render, screen } from '@testing-library/react';\n" +
                        "import '@testing-library/jest-dom';\n" +
                        "import { " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + " } from './" + widgetName + "';\n\n" +
                        "describe('" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + " Widget', () => {\n" +
                        "  const testId = '" + widgetName + "-test';\n\n" +
                        "  const mockProps = {\n" +
                        "    widgetData: {\n" +
                        "      items: [\n" +
                        "        {\n" +
                        "          id: 'item1',\n" +
                        "          title: 'Item 1',\n" +
                        "          description: 'Description 1',\n" +
                        "          imageUrl: 'https://example.com/image1.jpg',\n" +
                        "        },\n" +
                        "        {\n" +
                        "          id: 'item2',\n" +
                        "          title: 'Item 2',\n" +
                        "          description: 'Description 2',\n" +
                        "          imageUrl: 'https://example.com/image2.jpg',\n" +
                        "        }\n" +
                        "      ],\n" +
                        "      settings: {\n" +
                        "        columns: 2,\n" +
                        "        theme: 'light'\n" +
                        "      }\n" +
                        "    },\n" +
                        "    header: {\n" +
                        "      title: 'Test Header',\n" +
                        "      subtitle: 'Test Subtitle',\n" +
                        "    },\n" +
                        "    id: 'test-id',\n" +
                        "    testId: testId,\n" +
                        "  };\n\n" +
                        "  it('renders without crashing', () => {\n" +
                        "    render(<" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + " {...mockProps} />);\n" +
                        "    expect(screen.getByTestId(testId)).toBeInTheDocument();\n" +
                        "  });\n\n" +
                        "  it('renders empty state when no items provided', () => {\n" +
                        "    const emptyProps = {\n" +
                        "      ...mockProps,\n" +
                        "      widgetData: {\n" +
                        "        ...mockProps.widgetData,\n" +
                        "        items: []\n" +
                        "      }\n" +
                        "    };\n" +
                        "    render(<" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + " {...emptyProps} />);\n" +
                        "    expect(screen.getByTestId(testId + '-empty-state')).toBeInTheDocument();\n" +
                        "  });\n" +
                        "});",
                    description: "Unit tests for your widget",
                    path: basePath
                };
                // 5. Stories file for Storybook
                fileTemplates["stories"] = {
                    fileName: widgetName + ".stories.tsx",
                    content: "import type { Meta, StoryObj } from '@storybook/react';\n" +
                        "import { " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + " } from './" + widgetName + "';\n" +
                        (atomicComponents.length > 0
                            ? "// Import atomic components used by this widget\n" +
                                atomicComponents
                                    .filter(comp => validAtomicComponents.includes(comp))
                                    .map((comp) => `import { ${comp} } from '../../atomic-components/${comp}';\n`).join("")
                            : "") +
                        "\n" +
                        "const meta: Meta<typeof " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "> = {\n" +
                        "  title: 'Widgets/" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "',\n" +
                        "  component: " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + ",\n" +
                        "  parameters: {\n" +
                        "    layout: 'centered',\n" +
                        "    docs: {\n" +
                        "      description: {\n" +
                        "        component: '" + (widgetSpec.description || "A widget component for your application.") + "'\n" +
                        "      }\n" +
                        "    }\n" +
                        "  },\n" +
                        (atomicComponents.filter(comp => validAtomicComponents.includes(comp)).length > 0
                            ? "  // Include atomic components in the Storybook context\n" +
                                "  subcomponents: { " + atomicComponents.filter(comp => validAtomicComponents.includes(comp)).join(", ") + " },\n"
                            : "") +
                        "  tags: ['autodocs'],\n" +
                        "  argTypes: {\n" +
                        "    widgetData: { control: 'object' },\n" +
                        "    header: { control: 'object' },\n" +
                        "    id: { control: 'text' },\n" +
                        "    className: { control: 'text' },\n" +
                        "    testId: { control: 'text' }\n" +
                        "  }\n" +
                        "};\n\n" +
                        "export default meta;\n" +
                        "type Story = StoryObj<typeof " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + ">;\n\n" +
                        "export const Default: Story = {\n" +
                        "  args: {\n" +
                        "    widgetData: {\n" +
                        (widgetSpec.properties?.widgetData?.defaultStructure
                            ? "      // Sample data based on widget specification\n" +
                                "      " + JSON.stringify(widgetSpec.properties.widgetData.defaultStructure, null, 6).replace(/\n/g, '\n      ') + "\n"
                            : "      items: [\n" +
                                "        {\n" +
                                "          id: 'item1',\n" +
                                "          title: 'Item 1',\n" +
                                "          description: 'Description for item 1',\n" +
                                "          imageUrl: 'https://via.placeholder.com/600x400?text=Item+1',\n" +
                                "          link: 'https://example.com/item1'\n" +
                                "        },\n" +
                                "        {\n" +
                                "          id: 'item2',\n" +
                                "          title: 'Item 2',\n" +
                                "          description: 'Description for item 2',\n" +
                                "          imageUrl: 'https://via.placeholder.com/600x400?text=Item+2',\n" +
                                "          link: 'https://example.com/item2'\n" +
                                "        },\n" +
                                "        {\n" +
                                "          id: 'item3',\n" +
                                "          title: 'Item 3',\n" +
                                "          description: 'Description for item 3',\n" +
                                "          imageUrl: 'https://via.placeholder.com/600x400?text=Item+3',\n" +
                                "          link: 'https://example.com/item3'\n" +
                                "        }\n" +
                                "      ],\n" +
                                "      settings: {\n" +
                                "        columns: 3,\n" +
                                "        theme: 'light',\n" +
                                "        showBorder: true\n" +
                                "      }\n") +
                        "    },\n" +
                        "    header: {\n" +
                        "      title: 'Widget Title',\n" +
                        "      subtitle: 'Widget Subtitle for demonstration'\n" +
                        "    },\n" +
                        "    id: 'demo-widget',\n" +
                        "    testId: '" + widgetName + "-story'\n" +
                        "  }\n" +
                        "};\n\n" +
                        "export const Empty: Story = {\n" +
                        "  args: {\n" +
                        "    widgetData: {\n" +
                        "      items: [],\n" +
                        "      settings: {\n" +
                        "        columns: 3,\n" +
                        "        theme: 'light'\n" +
                        "      }\n" +
                        "    },\n" +
                        "    header: {\n" +
                        "      title: 'Empty Widget',\n" +
                        "      subtitle: 'This widget has no items to display'\n" +
                        "    },\n" +
                        "    id: 'empty-widget',\n" +
                        "    testId: '" + widgetName + "-empty-story'\n" +
                        "  }\n" +
                        "};\n\n" +
                        "export const DarkTheme: Story = {\n" +
                        "  args: {\n" +
                        "    ...Default.args,\n" +
                        "    widgetData: {\n" +
                        "      ...Default.args?.widgetData,\n" +
                        "      settings: {\n" +
                        "        columns: 3,\n" +
                        "        theme: 'dark',\n" +
                        "        showBorder: true\n" +
                        "      }\n" +
                        "    },\n" +
                        "    header: {\n" +
                        "      title: 'Dark Theme Widget',\n" +
                        "      subtitle: 'This widget uses the dark theme'\n" +
                        "    },\n" +
                        "    testId: '" + widgetName + "-dark-story'\n" +
                        "  }\n" +
                        "};",
                    description: "Storybook stories for your widget",
                    path: basePath
                };
                // If client framework is Next.js, include a page template
                if (clientFramework === 'next') {
                    fileTemplates["page"] = {
                        fileName: "page.tsx",
                        content: "import { " + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + " } from './" + widgetName + "';\n\n" +
                            "export default function Page() {\n" +
                            "  const widgetData = {\n" +
                            "    items: [\n" +
                            "      {\n" +
                            "        id: 'item1',\n" +
                            "        title: 'Example Item',\n" +
                            "        description: 'This is an example item',\n" +
                            "        imageUrl: '/placeholder.jpg',\n" +
                            "      }\n" +
                            "    ],\n" +
                            "    settings: {\n" +
                            "      columns: 3,\n" +
                            "      theme: 'light'\n" +
                            "    }\n" +
                            "  };\n\n" +
                            "  return (\n" +
                            "    <main className=\"container mx-auto p-4\">\n" +
                            "      <h1 className=\"text-2xl font-bold mb-6\">Widget Page</h1>\n" +
                            "      <" + widgetName.charAt(0).toUpperCase() + widgetName.slice(1) + "\n" +
                            "        widgetData={widgetData}\n" +
                            "        header={{\n" +
                            "          title: 'Widget Example',\n" +
                            "          subtitle: 'This is an example widget implementation'\n" +
                            "        }}\n" +
                            "        id=\"example-widget\"\n" +
                            "      />\n" +
                            "    </main>\n" +
                            "  );\n" +
                            "}",
                        description: "Next.js page template",
                        path: basePath
                    };
                }
                // Include a client script template if requested
                if (includeCodeSnippets) {
                    fileTemplates["client-script"] = {
                        fileName: "setup-" + widgetName + "-widget.js",
                        content: "/**\n" +
                            " * Widget Setup Script for " + widgetName + "\n" +
                            " * Usage: node setup-" + widgetName + "-widget.js\n" +
                            " */\n" +
                            "const fs = require('fs');\n" +
                            "const path = require('path');\n\n" +
                            "// Configuration\n" +
                            "const widgetName = '" + widgetName + "';\n" +
                            "const basePath = '" + basePath + "';\n" +
                            "const clientFramework = '" + clientFramework + "';\n\n" +
                            "console.log('Setting up widget: ' + widgetName);\n" +
                            "console.log('Base path: ' + basePath);\n\n" +
                            "// File templates will be populated below from the server response\n" +
                            "const fileTemplates = {\n" +
                            "  // This will be replaced with actual file templates\n" +
                            "};\n\n" +
                            "// Create the directory structure\n" +
                            "function createDirectory(directoryPath) {\n" +
                            "  if (!fs.existsSync(directoryPath)) {\n" +
                            "    fs.mkdirSync(directoryPath, { recursive: true });\n" +
                            "    console.log('Created directory: ' + directoryPath);\n" +
                            "  } else {\n" +
                            "    console.log('Directory already exists: ' + directoryPath);\n" +
                            "  }\n" +
                            "}\n\n" +
                            "// Create a file with content\n" +
                            "function createFile(filePath, content) {\n" +
                            "  try {\n" +
                            "    // Create the directory for the file if it doesn't exist\n" +
                            "    const directory = path.dirname(filePath);\n" +
                            "    createDirectory(directory);\n\n" +
                            "    // Write the file\n" +
                            "    fs.writeFileSync(filePath, content);\n" +
                            "    console.log('Created file: ' + filePath);\n" +
                            "    return true;\n" +
                            "  } catch (error) {\n" +
                            "    console.error('Error creating file ' + filePath + ':', error.message);\n" +
                            "    return false;\n" +
                            "  }\n" +
                            "}\n\n" +
                            "// Generate all widget files\n" +
                            "function generateWidgetFiles() {\n" +
                            "  console.log('Generating widget files...');\n" +
                            "  createDirectory(basePath);\n\n" +
                            "  const createdFiles = [];\n" +
                            "  const failedFiles = [];\n\n" +
                            "  // Create each file from templates\n" +
                            "  Object.entries(fileTemplates).forEach(([key, template]) => {\n" +
                            "    const filePath = path.join(basePath, template.fileName);\n" +
                            "    const success = createFile(filePath, template.content);\n" +
                            "    \n" +
                            "    if (success) {\n" +
                            "      createdFiles.push(template.fileName);\n" +
                            "    } else {\n" +
                            "      failedFiles.push(template.fileName);\n" +
                            "    }\n" +
                            "  });\n\n" +
                            "  return { createdFiles, failedFiles };\n" +
                            "}\n\n" +
                            "// Validate widget files\n" +
                            "function validateWidgetFiles() {\n" +
                            "  console.log('\\nValidating widget files...');\n\n" +
                            "  // Expected files based on client framework\n" +
                            "  const expectedFiles = [\n" +
                            "    widgetName + '.interface.ts',\n" +
                            "    widgetName + '.styles.ts',\n" +
                            "    widgetName + '.test.tsx',\n" +
                            "    widgetName + '.stories.tsx',\n" +
                            "  ];\n\n" +
                            "  // Add framework-specific files\n" +
                            "  if (clientFramework === 'next') {\n" +
                            "    expectedFiles.push('page.tsx');\n" +
                            "  } else {\n" +
                            "    expectedFiles.push(widgetName + '.tsx');\n" +
                            "  }\n\n" +
                            "  const results = {\n" +
                            "    success: true,\n" +
                            "    missingFiles: [],\n" +
                            "    foundFiles: []\n" +
                            "  };\n\n" +
                            "  // Check for each expected file\n" +
                            "  expectedFiles.forEach(fileName => {\n" +
                            "    const filePath = path.join(basePath, fileName);\n" +
                            "    if (fs.existsSync(filePath)) {\n" +
                            "      console.log('✅ Found: ' + fileName);\n" +
                            "      results.foundFiles.push(fileName);\n\n" +
                            "      // Check file content (basic validation)\n" +
                            "      const content = fs.readFileSync(filePath, 'utf-8');\n" +
                            "      if (content.length < 10) {\n" +
                            "        console.warn('⚠️ Warning: File seems empty or too small: ' + fileName);\n" +
                            "      }\n" +
                            "    } else {\n" +
                            "      console.error('❌ Missing: ' + fileName);\n" +
                            "      results.missingFiles.push(fileName);\n" +
                            "      results.success = false;\n" +
                            "    }\n" +
                            "  });\n\n" +
                            "  return results;\n" +
                            "}\n\n" +
                            "// Run the process\n" +
                            "console.log('='.repeat(50));\n" +
                            "console.log('WIDGET SETUP PROCESS');\n" +
                            "console.log('='.repeat(50));\n\n" +
                            "// Step 1: Generate files\n" +
                            "const generateResult = generateWidgetFiles();\n\n" +
                            "// Step 2: Validate files\n" +
                            "const validateResult = validateWidgetFiles();\n\n" +
                            "// Final summary\n" +
                            "console.log('\\n' + '='.repeat(50));\n" +
                            "console.log('SETUP SUMMARY');\n" +
                            "console.log('='.repeat(50));\n" +
                            "console.log('Widget: ' + widgetName);\n" +
                            "console.log('Files created: ' + generateResult.createdFiles.length);\n" +
                            "console.log('Files failed: ' + generateResult.failedFiles.length);\n" +
                            "console.log('Validation status: ' + (validateResult.success ? '✅ PASS' : '❌ FAIL'));\n\n" +
                            "if (generateResult.failedFiles.length > 0) {\n" +
                            "  console.log('Failed to create:');\n" +
                            "  generateResult.failedFiles.forEach(file => console.log('- ' + file));\n" +
                            "}\n\n" +
                            "if (validateResult.missingFiles.length > 0) {\n" +
                            "  console.log('Missing files:');\n" +
                            "  validateResult.missingFiles.forEach(file => console.log('- ' + file));\n" +
                            "}\n\n" +
                            "console.log('\\nNext steps:');\n" +
                            "console.log('1. Review and customize the generated files');\n" +
                            "console.log('2. Run tests with: npm test -- ' + widgetName);\n" +
                            "console.log('3. View in Storybook: npm run storybook');\n" +
                            "console.log('4. Import and integrate the widget into your app');\n\n" +
                            "console.log('Setup ' + (validateResult.success ? 'completed successfully! 🎉' : 'completed with issues ⚠️'));\n",
                        description: "Client-side script for setting up widget files with validation",
                        path: "./"
                    };
                }
                // Create the response with file templates and status
                const response = {
                    success: true,
                    message: "Widget file templates generated successfully",
                    widget: {
                        name: widgetName,
                        type: normalizedType,
                        description: widgetSpec.description || "",
                        recommendedDirectory: basePath,
                        clientFramework,
                        fileTemplates,
                        runClientCommands: true,
                        atomicComponents: atomicComponents.filter(comp => validAtomicComponents.includes(comp))
                    },
                    fileTemplates: fileTemplates,
                    atomicComponentsData: detailedAtomicComponentsData,
                    validAtomicComponents: {
                        available: validAtomicComponents,
                        used: atomicComponents.filter(comp => validAtomicComponents.includes(comp)),
                        invalid: invalidAtomicComponents,
                        suggestions: widgetElementSuggestions
                    },
                    clientInstructions: {
                        manual: [
                            "1. Create the directory structure: mkdir -p " + basePath,
                            "2. Save each file template to the corresponding path",
                            "3. Update the interface file with your specific data requirements",
                            "4. Run your tests with: npm test -- " + widgetName,
                            "5. View the widget in Storybook: npm run storybook"
                        ],
                        automated: includeCodeSnippets ? [
                            "1. Save the setup script as 'setup-" + widgetName + "-widget.js'",
                            "2. Edit the script to include the file templates from this response",
                            "3. Run: node setup-" + widgetName + "-widget.js",
                            "4. The script will generate files and validate them in one step",
                            "5. Review the validation output and fix any issues",
                            "6. Customize the generated files for your specific requirements",
                            "7. View the widget in Storybook: npm run storybook"
                        ] : null,
                        integration: [
                            "1. Import the widget from the appropriate path",
                            "2. Add it to your page/component with appropriate props",
                            "3. Ensure the widget type is registered in WidgetMap.ts",
                            "4. Use the stories file as a reference for implementation examples"
                        ],
                        atomicComponents: atomicComponents.filter(comp => validAtomicComponents.includes(comp)).length > 0 ? [
                            "Ensure the following atomic components are imported correctly:",
                            ...atomicComponents
                                .filter(comp => validAtomicComponents.includes(comp))
                                .map((comp) => `- ${comp}: ${detailedAtomicComponentsData[comp]?.description || "No description available"}`)
                        ] : [
                            "No valid atomic components specified. Available components are:",
                            ...validAtomicComponents.map(comp => `- ${comp}`)
                        ]
                    },
                    nextStep: {
                        tool: "generateWidgetFiles",
                        params: {
                            widgetName: widgetName,
                            basePath: basePath,
                            clientFramework,
                            fileTemplates,
                            runClientCommands: false // Set to false since we'll return templates for client to create
                        },
                        description: "Prepare the widget files from templates for client-side creation"
                    }
                };
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(response, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                message: "Failed to generate widget file templates: " + errorMessage
                            }, null, 2)
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("validateWidgetFiles", {
            widgetName: z.string().min(3),
            basePath: z.string(),
            clientFramework: z.enum(['react', 'next', 'gatsby']).optional().default('react'),
            missingFiles: z.array(z.string()).optional(),
            atomicComponents: z.array(z.string()).optional(),
            fileTemplates: z.record(z.any()).optional(),
            runClientCommands: z.boolean().optional().default(false)
        }, async ({ widgetName, basePath, clientFramework = 'react', missingFiles = [], atomicComponents = [], fileTemplates, runClientCommands = false }) => {
            try {
                // Define valid atomic components based on component-spec/atomic-components.json
                const validAtomicComponents = ["Button", "Typography", "OptimizedImage", "OptimizedVideo"];
                // Check if specified atomic components are valid
                const invalidAtomicComponents = atomicComponents.filter(comp => !validAtomicComponents.includes(comp));
                console.log(`Validating widget files for: ${widgetName} in ${basePath}`);
                // Get expected file list based on client framework
                const expectedFiles = [
                    widgetName + '.interface.ts',
                    widgetName + '.styles.ts',
                    widgetName + '.test.tsx',
                    widgetName + '.stories.tsx'
                ];
                if (clientFramework === 'next') {
                    expectedFiles.push('page.tsx');
                }
                else {
                    expectedFiles.push(widgetName + '.tsx');
                }
                let actualMissingFiles = [...missingFiles];
                let foundFiles = [];
                // If runClientCommands is true, actually check the files on the system
                if (runClientCommands) {
                    console.log("Running client-side file validation...");
                    // Reset missing files since we'll determine them directly
                    actualMissingFiles = [];
                    // Check if directory exists
                    if (!fs.existsSync(basePath)) {
                        console.error(`❌ Base directory does not exist: ${basePath}`);
                        actualMissingFiles.push(basePath + ' (directory)');
                        // Don't create the directory on the server side, just report it
                        console.log(`Directory needed: ${basePath}`);
                    }
                    else {
                        console.log(`✅ Base directory exists: ${basePath}`);
                    }
                    // Check for each expected file
                    for (const fileName of expectedFiles) {
                        const filePath = path.join(basePath, fileName);
                        if (fs.existsSync(filePath)) {
                            console.log(`✅ Found file: ${fileName}`);
                            // Check file content (basic validation)
                            const content = fs.readFileSync(filePath, 'utf-8');
                            if (content.length < 10) {
                                console.warn(`⚠️ Warning: File seems empty or too small: ${fileName}`);
                            }
                            foundFiles.push(fileName);
                        }
                        else {
                            console.error(`❌ Missing file: ${fileName}`);
                            actualMissingFiles.push(fileName);
                        }
                    }
                }
                // Prepare missing file templates if needed
                let missingFileTemplates = {};
                if (actualMissingFiles.length > 0 && fileTemplates) {
                    console.log(`Preparing information for ${actualMissingFiles.length} missing files...`);
                    // Create file templates for only the missing files
                    for (const [key, template] of Object.entries(fileTemplates)) {
                        const fileName = template.fileName;
                        if (actualMissingFiles.includes(fileName)) {
                            missingFileTemplates[key] = template;
                        }
                    }
                    console.log(`Found templates for ${Object.keys(missingFileTemplates).length} missing files`);
                }
                // Generate validation script template for future use
                const validationScriptContent = `
/**
 * Widget Files Validation Script for ${widgetName}
 * Usage: node validate-${widgetName}-files.js
 */
const fs = require('fs');
const path = require('path');

// Configuration
const widgetName = '${widgetName}';
const basePath = '${basePath}';
const expectedFiles = ${JSON.stringify(expectedFiles, null, 2)};
const validAtomicComponents = ${JSON.stringify(validAtomicComponents, null, 2)};
const declaredAtomicComponents = ${JSON.stringify(atomicComponents, null, 2)};

console.log('Validating widget files for: ' + widgetName);
console.log('Base path: ' + basePath);
console.log('Atomic components: ' + (declaredAtomicComponents.length > 0 ? declaredAtomicComponents.join(', ') : 'None'));

// Results tracking
const results = {
  success: true,
  missingFiles: [],
  foundFiles: [],
  atomicComponentsUsage: {
    declared: declaredAtomicComponents,
    found: [],
    unused: [],
    incorrectlyUsed: []
  }
};

// Check if directory exists
if (!fs.existsSync(basePath)) {
  console.error('❌ Base directory does not exist: ' + basePath);
  results.success = false;
  results.missingFiles.push(basePath + ' (directory)');
} else {
  console.log('✅ Base directory exists');
  
  // Check for each expected file
  expectedFiles.forEach(fileName => {
    const filePath = path.join(basePath, fileName);
    if (fs.existsSync(filePath)) {
      console.log('✅ Found file: ' + fileName);
      
      // Check file content (basic validation)
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.length < 10) {
        console.warn('⚠️ Warning: File seems empty or too small: ' + fileName);
      }
      
      // Check for atomic components usage in component file
      if (fileName.endsWith('.tsx') && declaredAtomicComponents.length > 0) {
        declaredAtomicComponents.forEach(comp => {
          const importRegex = new RegExp(\`import\\s+{[^}]*\\b\${comp}\\b[^}]*}\\s+from\\s+(['"])../../atomic-components/\${comp}\\1\`);
          const usageRegex = new RegExp(\`<\${comp}[\\s>]\`);
          
          const hasImport = importRegex.test(content);
          const hasUsage = usageRegex.test(content);
          
          if (hasImport && hasUsage) {
            console.log(\`✅ Atomic component \${comp} is correctly imported and used\`);
            if (!results.atomicComponentsUsage.found.includes(comp)) {
              results.atomicComponentsUsage.found.push(comp);
            }
          } else if (hasImport && !hasUsage) {
            console.warn(\`⚠️ Atomic component \${comp} is imported but not used\`);
            if (!results.atomicComponentsUsage.unused.includes(comp)) {
              results.atomicComponentsUsage.unused.push(comp);
            }
          } else if (!hasImport && hasUsage) {
            console.error(\`❌ Atomic component \${comp} is used but not properly imported\`);
            if (!results.atomicComponentsUsage.incorrectlyUsed.includes(comp)) {
              results.atomicComponentsUsage.incorrectlyUsed.push(comp);
            }
          } else {
            console.error(\`❌ Atomic component \${comp} is not used in this file\`);
            if (!results.atomicComponentsUsage.unused.includes(comp)) {
              results.atomicComponentsUsage.unused.push(comp);
            }
          }
        });
      }
      
      results.foundFiles.push(fileName);
    } else {
      console.error('❌ Missing file: ' + fileName);
      results.missingFiles.push(fileName);
      results.success = false;
    }
  });
}

// Summary
console.log('\\nValidation Summary:');
console.log('------------------------------');
console.log('Widget: ' + widgetName);
console.log('Files found: ' + results.foundFiles.length + '/' + expectedFiles.length);
console.log('Files missing: ' + results.missingFiles.length);

// Atomic components summary
if (declaredAtomicComponents.length > 0) {
  console.log('\\nAtomic Components Usage:');
  console.log('------------------------------');
  console.log('Declared components: ' + declaredAtomicComponents.length);
  console.log('Correctly used components: ' + results.atomicComponentsUsage.found.length);
  console.log('Unused components: ' + results.atomicComponentsUsage.unused.length);
  console.log('Incorrectly used components: ' + results.atomicComponentsUsage.incorrectlyUsed.length);
  
  if (results.atomicComponentsUsage.unused.length > 0) {
    console.log('\\nUnused components:');
    results.atomicComponentsUsage.unused.forEach(comp => console.log('- ' + comp));
  }
  
  if (results.atomicComponentsUsage.incorrectlyUsed.length > 0) {
    console.log('\\nIncorrectly used components:');
    results.atomicComponentsUsage.incorrectlyUsed.forEach(comp => console.log('- ' + comp));
  }
  
  const atomicSuccess = results.atomicComponentsUsage.unused.length === 0 && 
                        results.atomicComponentsUsage.incorrectlyUsed.length === 0;
  
  if (!atomicSuccess) {
    results.success = false;
  }
}

console.log('\\nOverall status: ' + (results.success ? '✅ PASS' : '❌ FAIL'));

if (results.missingFiles.length > 0) {
  console.log('\\nMissing files:');
  results.missingFiles.forEach(file => console.log('- ' + file));
  
  console.log('\\nRecommended action:');
  console.log('1. Run the generateWidgetFiles tool again');
  console.log('2. Make sure all file templates are correctly created on your system');
  console.log('3. Check file permissions in your directory');
}

// Export results
if (typeof module !== 'undefined') {
  module.exports = results;
}
`;
                // Determine a recommendation based on the results
                let correctiveAction = "";
                if (actualMissingFiles.length > 0) {
                    if (Object.keys(missingFileTemplates).length > 0) {
                        correctiveAction = "Use the generateWidgetFiles tool to create the missing files on the client side";
                    }
                    else {
                        correctiveAction = "Create the missing files manually based on expected structure";
                    }
                }
                else {
                    correctiveAction = "No corrective action needed, all expected files exist";
                }
                // Return validation results
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: actualMissingFiles.length === 0,
                                widgetName,
                                basePath,
                                clientFramework,
                                expectedFiles,
                                foundFiles,
                                missingFiles: actualMissingFiles,
                                missingFileTemplates: Object.keys(missingFileTemplates).length > 0 ? missingFileTemplates : undefined,
                                validation: {
                                    atomicComponents: {
                                        valid: invalidAtomicComponents.length === 0,
                                        invalid: invalidAtomicComponents,
                                        available: validAtomicComponents
                                    }
                                },
                                correctiveAction: correctiveAction,
                                manualVerification: {
                                    checklist: [
                                        "1. Ensure the component renders correctly",
                                        "2. Verify that the TypeScript interfaces are defined properly",
                                        "3. Check that the styles are applied as expected",
                                        "4. Run the unit tests to ensure they pass",
                                        "5. View the component in Storybook to verify visual appearance",
                                        "6. Validate props against the widget specification"
                                    ],
                                    importance: "After automated validation, perform these manual checks to ensure quality"
                                },
                                bestPractices: [
                                    "Follow the component naming conventions consistently",
                                    "Ensure props are properly typed with meaningful JSDoc comments",
                                    "Keep the widget implementation focused on a single responsibility",
                                    "Use atomic components for consistent UI elements",
                                    "Keep the tests up-to-date with any implementation changes",
                                    "Use descriptive variable names for better code readability",
                                    "Add appropriate error handling for data-dependent components"
                                ],
                                nextStep: actualMissingFiles.length > 0 && fileTemplates
                                    ? {
                                        tool: "generateWidgetFiles",
                                        params: {
                                            widgetName,
                                            basePath,
                                            clientFramework,
                                            runClientCommands: false, // Changed to false
                                            fileTemplates
                                        },
                                        description: "Prepare missing files for client-side creation with complete templates"
                                    }
                                    : null
                            }, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                message: "Failed to prepare widget files validation guidance: " + errorMessage
                            }, null, 2)
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("generateWidgetFiles", {
            widgetName: z.string().min(3),
            basePath: z.string().optional(),
            clientFramework: z.enum(['react', 'next', 'gatsby']).optional().default('react'),
            atomicComponents: z.array(z.string()).optional(),
            targetDirectory: z.string().optional(),
            fileTemplates: z.record(z.object({
                fileName: z.string(),
                content: z.string(),
                description: z.string().optional(),
                path: z.string().optional()
            }))
        }, async ({ widgetName, basePath, clientFramework = 'react', atomicComponents = [], targetDirectory, fileTemplates }) => {
            try {
                console.log(`Preparing widget files for: ${widgetName}`);
                // Determine the base path where files will be created
                const actualBasePath = basePath || targetDirectory || `src/mono/web-core/auditedWidgets/${widgetName}`;
                // Track files that will be created
                const filesToCreate = [];
                // Prepare file information for each template
                Object.entries(fileTemplates).forEach(([key, template]) => {
                    // Determine the path for the file
                    const templatePath = template.path || actualBasePath;
                    const filePath = path.join(templatePath, template.fileName);
                    // Add file to the list
                    filesToCreate.push({
                        filePath,
                        content: template.content,
                        description: template.description
                    });
                });
                // Expected files based on client framework
                const expectedFiles = [
                    widgetName + '.interface.ts',
                    widgetName + '.styles.ts',
                    widgetName + '.test.tsx',
                    widgetName + '.stories.tsx'
                ];
                if (clientFramework === 'next') {
                    expectedFiles.push('page.tsx');
                }
                else {
                    expectedFiles.push(widgetName + '.tsx');
                }
                // Return the file templates and instructions for the client
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                message: `Prepared widget files for '${widgetName}' for client-side creation`,
                                basePath: actualBasePath,
                                widgetName,
                                clientFramework,
                                filesToCreate,
                                instructions: {
                                    step1: "Create the base directory if it doesn't exist: " + actualBasePath,
                                    step2: "Create each file with the provided content",
                                    step3: "Verify all expected files are created correctly"
                                },
                                expectedFiles,
                                nextSteps: {
                                    message: "After creating the files, you can use the widget",
                                    suggestions: [
                                        "Run tests with: npm test -- " + widgetName,
                                        "View the widget in Storybook: npm run storybook",
                                        "Integrate the widget into your application"
                                    ]
                                }
                            }, null, 2)
                        }]
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                message: "Failed to prepare widget files: " + errorMessage
                            }, null, 2)
                        }],
                    isError: true
                };
            }
        });
        this.server.tool("addWidgetToMap", {
            widgetName: z.string().min(3),
            widgetType: z.string().min(3)
        }, async ({ widgetName, widgetType }) => {
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
            }
            catch (error) {
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
        });
    }
    async connect(transport) {
        await this.server.connect(transport);
        this.sseTransport = transport;
        console.log("Server connected and ready to process requests");
    }
    async startHttpServer(port) {
        const app = express();
        app.use(cors());
        // SSE endpoint
        app.get("/sse", async (req, res) => {
            console.log("New SSE connection established");
            const transport = new SSEServerTransport("/messages", res);
            await this.connect(transport);
        });
        // Message endpoint for handling client messages
        app.post("/messages", async (req, res) => {
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
function detectWidgetTypeFromFigma(node) {
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
function generateInterfaceFromStructure(structure, indent = "  ") {
    if (!structure || typeof structure !== 'object') {
        return indent + "// No structure defined\n";
    }
    let result = "";
    if (Array.isArray(structure)) {
        // Handle array type
        if (structure.length === 0) {
            return indent + "items?: any[];\n";
        }
        else {
            const firstItem = structure[0];
            if (typeof firstItem === 'object' && firstItem !== null) {
                result += indent + "items?: Array<{\n";
                result += generateInterfaceFromStructure(firstItem, indent + "  ");
                result += indent + "}>;\n";
            }
            else {
                // Simple array of primitives
                const type = typeof firstItem;
                result += indent + `items?: ${type}[];\n`;
            }
        }
    }
    else {
        // Handle object type
        for (const [key, value] of Object.entries(structure)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result += indent + `${key}?: {\n`;
                result += generateInterfaceFromStructure(value, indent + "  ");
                result += indent + "};\n";
            }
            else if (Array.isArray(value)) {
                if (value.length === 0) {
                    result += indent + `${key}?: any[];\n`;
                }
                else {
                    const firstItem = value[0];
                    if (typeof firstItem === 'object' && firstItem !== null) {
                        result += indent + `${key}?: Array<{\n`;
                        result += generateInterfaceFromStructure(firstItem, indent + "  ");
                        result += indent + "}>;\n";
                    }
                    else {
                        // Simple array of primitives
                        const type = typeof firstItem;
                        result += indent + `${key}?: ${type}[];\n`;
                    }
                }
            }
            else {
                // Handle primitive types
                const type = typeof value;
                if (type === 'string' && value.match(/^(https?:\/\/|\/)/)) {
                    // URL strings
                    result += indent + `${key}?: string; // URL\n`;
                }
                else if (type === 'number' && value % 1 === 0) {
                    result += indent + `${key}?: number; // integer\n`;
                }
                else if (type === 'number') {
                    result += indent + `${key}?: number; // float\n`;
                }
                else {
                    result += indent + `${key}?: ${type};\n`;
                }
            }
        }
    }
    return result;
}
// Helper function to convert string to Title Case
function toTitleCase(str) {
    return str
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
function convertFigmaToLayout(node) {
    if (!node.layout)
        return null;
    return {
        type: node.layout.layoutMode === 'NONE' ? 'FIXED' : 'FLUID',
        verticalSpacing: {
            top: convertFigmaSpacing(node.layout.padding?.top),
            bottom: convertFigmaSpacing(node.layout.padding?.bottom)
        }
    };
}
function convertFigmaSpacing(spacing) {
    if (!spacing)
        return 'NORMAL';
    if (spacing <= 16)
        return 'COMPACT';
    if (spacing >= 32)
        return 'LOOSE';
    return 'NORMAL';
}
function extractHeaderFromFigma(node) {
    // Look for text nodes that might be headers
    const textNodes = findTextNodes(node);
    if (textNodes.length === 0)
        return null;
    const header = {};
    // Find subtitle and label
    textNodes.forEach(textNode => {
        if (textNode.textStyle?.fontSize >= 24) {
            header.label = textNode.characters;
        }
        else if (textNode.textStyle?.fontSize >= 16) {
            header.subtitle = textNode.characters;
        }
    });
    if (Object.keys(header).length === 0)
        return null;
    // Get text alignment
    const mainTextNode = textNodes[0];
    header.desktopTextAlign = convertFigmaTextAlign(mainTextNode.textStyle?.textAlignHorizontal);
    return header;
}
function extractWidgetDataFromFigma(node, widgetType) {
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
function extractMediaSliderData(node) {
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
function findTextNodes(node) {
    const textNodes = [];
    if (node.type === 'TEXT') {
        textNodes.push(node);
    }
    if (node.children) {
        node.children.forEach((child) => {
            textNodes.push(...findTextNodes(child));
        });
    }
    return textNodes;
}
function findImageNodes(node) {
    const imageNodes = [];
    if (node.type === 'RECTANGLE' && node.style?.fills?.some((fill) => fill.type === 'IMAGE')) {
        imageNodes.push(node);
    }
    if (node.children) {
        node.children.forEach((child) => {
            imageNodes.push(...findImageNodes(child));
        });
    }
    return imageNodes;
}
function convertFigmaTextAlign(align) {
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
function extractImageUrl(node) {
    const imageFill = node.style?.fills?.find((fill) => fill.type === 'IMAGE');
    return imageFill?.imageRef || '';
}
function validateWidgetConfig(config, widgetType) {
    // Add validation logic based on widget type
    const errors = [];
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
function extractProductGridData(node) {
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
// Helper function to create default structure based on category
function createDefaultStructureByCategory(category) {
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
