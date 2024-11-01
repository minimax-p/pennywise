import type {Metadata} from "next";
import localFont from "next/font/local";
import "./globals.css";
import {
    ClerkProvider,
    SignInButton,
    SignedIn,
    SignedOut,
    UserButton
} from '@clerk/nextjs'
import './globals.css'
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
        <ClerkProvider afterSignOutUrl="/sign-in">
            <html lang="en" className="dark" style={{colorScheme: "dark",}} suppressHydrationWarning>
                <body className={inter.className}>
                    <Toaster richColors position="bottom-right" />
                    <RootProviders>{children}</RootProviders>
                </body>
            </html>
        </ClerkProvider>
    )
}