import type {MetadataRoute} from "next";

// Lets Pennywise be added to the iPhone home screen and open like an app
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Pennywise",
        short_name: "Pennywise",
        description: "Every account and every dollar in one place",
        start_url: "/",
        display: "standalone",
        background_color: "#F8F7FC",
        theme_color: "#F8F7FC",
        icons: [
            {src: "/icon-192.png", sizes: "192x192", type: "image/png"},
            {src: "/icon-512.png", sizes: "512x512", type: "image/png"},
            {src: "/icon.svg", sizes: "any", type: "image/svg+xml"},
        ],
    };
}
