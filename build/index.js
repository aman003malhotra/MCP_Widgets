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
                        const key = file.replace("-widget.json", "").toUpperCase().replace(/-/g, '_');
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
                    const widgetInfo = widgetDescriptions.get(key) || {
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
                            fileName: key.toLowerCase().replace(/_/g, '-') + '-widget.json'
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
            widgetName: z.string()
        }, async ({ widgetName }) => {
            try {
                const configPath = path.join(COMPONENT_SPEC_DIR, 'widget-configs', `${widgetName}.json`);
                if (!fs.existsSync(configPath)) {
                    throw new Error(`Widget config '${widgetName}' not found`);
                }
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                const validationResults = [];
                // Validate basic structure
                if (!config.name || !config.widgets || !Array.isArray(config.widgets)) {
                    validationResults.push("Invalid basic structure: must have 'name' and 'widgets' array");
                }
                // Validate each widget
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
                                config: validationResults.length === 0 ? config : undefined
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
