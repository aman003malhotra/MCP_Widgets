import { z } from 'zod';
export const FigmaConstraintsSchema = z.object({
    horizontal: z.enum(['LEFT', 'RIGHT', 'CENTER', 'SCALE', 'STRETCH']),
    vertical: z.enum(['TOP', 'BOTTOM', 'CENTER', 'SCALE', 'STRETCH'])
});
export const FigmaLayoutSchema = z.object({
    layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']).optional(),
    primaryAxisSizingMode: z.enum(['FIXED', 'AUTO']).optional(),
    counterAxisSizingMode: z.enum(['FIXED', 'AUTO']).optional(),
    primaryAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX']).optional(),
    padding: z.number().optional(),
    itemSpacing: z.number().optional()
});
export const FigmaStyleSchema = z.object({
    fills: z.array(z.any()).optional(),
    strokes: z.array(z.any()).optional(),
    effects: z.array(z.any()).optional(),
    opacity: z.number().optional()
});
export const FigmaTextStyleSchema = z.object({
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.number().optional(),
    textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional(),
    textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional(),
    letterSpacing: z.number().optional(),
    lineHeight: z.number().optional()
});
export const FigmaNodeSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    layout: FigmaLayoutSchema.optional(),
    style: FigmaStyleSchema.optional(),
    textStyle: FigmaTextStyleSchema.optional(),
    children: z.array(z.lazy(() => FigmaNodeSchema)).optional(),
    constraints: FigmaConstraintsSchema.optional()
});
export const FigmaComponentInputSchema = z.object({
    node: FigmaNodeSchema,
    componentName: z.string(),
    description: z.string().optional()
});
