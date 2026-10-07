import type {Metadata, Viewport} from "next";
import {Fredoka, Nunito} from "next/font/google";
import "./globals.css";
import RootProviders from "@/components/providers/RootProviders";
import {Toaster} from "@/components/ui/sonner";
import React, {ReactNode} from "react";

// Rounded, friendly type: Fredoka for headings and big numbers, Nunito for everything else
const nunito = Nunito({subsets: ["latin"], variable: "--font-nunito", display: "swap"});
const fredoka = Fredoka({subsets: ["latin"], variable: "--font-fredoka", display: "swap", weight: ["400", "500", "600", "700"]});

export const metadata: Metadata = {
    title: "Pennywise",
    description: "Every account and every dollar in one place.",
    appleWebApp: {capable: true, title: "Pennywise", statusBarStyle: "default"},
    icons: {icon: "/icon.svg", apple: "/apple-touch-icon.png"},
};

export const viewport: Viewport = {
    // Lets the bottom tab bar sit above the iPhone home indicator
    viewportFit: "cover",
    themeColor: [
        {media: "(prefers-color-scheme: light)", color: "#F8F7FC"},
        {media: "(prefers-color-scheme: dark)", color: "#1C1B2B"},
    ],
};

export default function RootLayout({children}: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en" className={`${nunito.variable} ${fredoka.variable}`} suppressHydrationWarning>
            <body className="selection:bg-primary/25">
                <RootProviders>
                    {children}
                    <Toaster richColors position="top-center"/>
                </RootProviders>
            </body>
        </html>
    )
}
