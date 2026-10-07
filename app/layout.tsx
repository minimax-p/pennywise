import type {Metadata} from "next";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import "./globals.css";
import RootProviders from "@/components/providers/RootProviders";
import {Toaster} from "@/components/ui/sonner";
import {Inter} from "next/font/google";
import React, {ReactNode} from "react";

const inter = Inter({subsets: ["latin"]});

export const metadata: Metadata = {
    title: "Pennywise",
    description: "Simple personal finance app.",
};


export default function RootLayout({children}: Readonly<{children: ReactNode }>) {
    return (
        <html lang="en" className="dark selection:bg-amber-900 selection:text-amber-300" style={{colorScheme: "dark",}} suppressHydrationWarning>
            <body className={`${GeistSans.variable} ${GeistMono.variable} ${inter.className}`}>
                <Toaster richColors position="bottom-right" />
                <RootProviders>{children}</RootProviders>
            </body>
        </html>
    )
}