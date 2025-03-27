import { z } from "zod";
// Common schemas
export const MediaSchema = z.object({
    mediaType: z.enum(['image', 'video']),
    source: z.string().url(),
    altText: z.string(),
    loading: z.enum(['lazy', 'eager']).default('lazy')
});
export const LayoutSchema = z.object({
    type: z.enum(['FLUID', 'FIXED']),
    verticalSpacing: z.object({
        top: z.enum(['COMPACT', 'NORMAL', 'LOOSE']),
        bottom: z.enum(['COMPACT', 'NORMAL', 'LOOSE'])
    })
});
export const HeaderSchema = z.object({
    subtitle: z.string().optional(),
    subtileType: z.enum(['PRIMARY', 'SECONDARY']).optional(),
    label: z.string().optional(),
    desktopTextAlign: z.enum(['left', 'center', 'right']).optional()
});
// Widget-specific schemas
export const SliderConfigSchema = z.object({
    aspectRatio: z.number(),
    slidesToShow: z.number(),
    slidesToShowDesktop: z.number(),
    showPeek: z.boolean(),
    showDots: z.boolean()
});
export const ProductCardSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    price: z.number(),
    currency: z.string(),
    imageUrl: z.string().url(),
    link: z.string().url()
});
export const GridConfigSchema = z.object({
    columns: z.number(),
    columnsDesktop: z.number(),
    gap: z.number(),
    aspectRatio: z.number().optional()
});
// Widget Data Type Schemas
export const MediaSliderData = z.object({
    sliderConfig: SliderConfigSchema,
    showBorder: z.boolean().optional(),
    items: z.array(z.object({ media: MediaSchema }))
});
export const ProductGridData = z.object({
    gridConfig: GridConfigSchema,
    products: z.array(ProductCardSchema)
});
// Map of widget types to their data schemas
export const WidgetDataSchemas = {
    MEDIA_SLIDER: MediaSliderData,
    PRODUCT_CARD_GRID: ProductGridData,
    // Add more widget type to schema mappings
};
