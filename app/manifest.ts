import type {MetadataRoute} from "next";

// Lets Pennywise be added to the iPhone home screen and open like an app
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Pennywise",
        short_name: "Pennywise",
        description: "Personal finance tracker",
        start_url: "/",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#000000",
        icons: [
            {src: "/icon-192.png", sizes: "192x192", type: "image/png"},
            {src: "/icon-512.png", sizes: "512x512", type: "image/png"},
        ],
    };
}
