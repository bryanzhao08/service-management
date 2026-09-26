import { defineConfig } from "@neon/config/v1";

/**
 * Object storage for guard photos and generated report PDFs. Private because
 * every object is reached through a presigned URL minted by the app after it
 * has checked the caller's company scope — a public bucket would make the
 * scoping in `src/lib/storage/` decorative.
 */
export default defineConfig({
  buckets: {
    media: {
      access: "private",
    },
  },
});
