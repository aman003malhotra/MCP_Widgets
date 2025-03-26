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
        type: z.enum(["atomic", "widget", "all"]).default("all")
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
                Object.keys(component.props).some(prop => prop.toLowerCase().includes(searchTerm))
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
          
          if (type === "widget" || type === "all") {
            const widgetFiles = fs.readdirSync(WIDGETS_DIR)
              .filter(file => file.endsWith(".json"));
            
            for (const file of widgetFiles) {
              const filePath = path.join(WIDGETS_DIR, file);
              const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WidgetData;
              
              if (Array.isArray(widgetData.widgets)) {
                widgetData.widgets.forEach((widget: Widget) => {
                  if (
                    widget.name.toLowerCase().includes(searchTerm) ||
                    widget.description.toLowerCase().includes(searchTerm) ||
                    Object.keys(widget.props).some(prop => prop.toLowerCase().includes(searchTerm))
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
        componentType: z.enum(["atomic", "widget"])
      },
      async ({ componentName, componentType }) => {
        try {
          if (componentType === "atomic") {
            const atomicData = JSON.parse(fs.readFileSync(ATOMIC_COMPONENTS_PATH, "utf-8")) as AtomicComponentsData;
            const component = atomicData.components.find((c: Component) => c.name === componentName);
            
            if (!component) {
              throw new Error(`Atomic component '${componentName}' not found`);
            }
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify(component.props, null, 2)
              }]
            };
          } else {
            const widgetFiles = fs.readdirSync(WIDGETS_DIR)
              .filter(file => file.endsWith(".json"));
            
            for (const file of widgetFiles) {
              const filePath = path.join(WIDGETS_DIR, file);
              const widgetData = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WidgetData;
              
              if (Array.isArray(widgetData.widgets)) {
                const widget = widgetData.widgets.find((w: Widget) => w.name === componentName);
                
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