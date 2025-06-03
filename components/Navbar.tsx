"use client";

import React, { useState } from 'react';
import Logo, { LogoMobile } from "@/components/Logo";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { UserButton } from "@clerk/nextjs";
import { ModeToggle } from "@/components/ThemeSwitcherBtn";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function Navbar() {
    return (
        <>
            <DesktopNavbar />
            <MobileNavbar />
        </>
    )
}

const items = [
    { label: "Dashboard", link: "/" },
    { label: "Transactions", link: "/transactions" },
    { label: 'Manage', link: "/manage" },
]

function MobileNavbar() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="block border-separate bg-background md:hidden"
        >
            <nav className="container flex items-center justify-between px-6">
                <Sheet open={isOpen} onOpenChange={setIsOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <Menu />
                        </Button>
                    </SheetTrigger>
                    <SheetContent className={"w=[400px] sm:w-[540px]"} side="left">
                        <Logo />
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3, delay: 0.1 }}
                            className="flex flex-col gap-1 pt-4"
                        >
                            {items.map((item, index) => (
                                <motion.div
                                    key={item.label}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.3, delay: 0.1 * (index + 1) }}
                                >
                                    <NavbarItem
                                        link={item.link}
                                        label={item.label}
                                        clickCallBack={() => setIsOpen((prev) => !prev)}
                                    />
                                </motion.div>
                            ))}
                        </motion.div>
                    </SheetContent>
                </Sheet>
                <div className="flex h-[80px] min-h-[60px] items-center gap-x-4">
                    <LogoMobile />
                </div>
                <div className="flex items-center gap-2">
                    <ModeToggle />
                    <UserButton />
                </div>
            </nav>
        </motion.div>
    )
}

function DesktopNavbar() {
    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="hidden border-separate border-b bg-background md:block"
        >
            <nav className="container flex items-center justify-between px-8">
                <div className="flex h-[80px] items-center gap-x-8">
                    <Logo />
                    <div className="flex h-full items-center">
                        {items.map((item, index) => (
                            <motion.div
                                key={item.label}
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: 0.1 * index }}
                            >
                                <NavbarItem
                                    link={item.link}
                                    label={item.label}
                                />
                            </motion.div>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <ModeToggle />
                    <UserButton />
                </div>
            </nav>
        </motion.div>
    )
}

function NavbarItem({ link, label, clickCallBack }: {
    link: string,
    label: string,
    clickCallBack?: () => void
}) {
    const pathname = usePathname()
    const isActive = pathname === link
    return (
        <div className="relative flex items-center">
            <Link href={link} className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full font-mono justify-start text-lg text-muted-foreground hover:text-foreground",
                isActive && "text-foreground")}
                  onClick={() => {
                      if (clickCallBack) clickCallBack();
                  }}
            >
                {label}
            </Link>
            <AnimatePresence>
                {isActive && (
                    <motion.div
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "80%" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute -bottom-[2px] left-1/2 hidden h-[2px] -translate-x-1/2 rounded-xl bg-foreground md:block"
                    />
                )}
            </AnimatePresence>
        </div>
    )
}

export default Navbar;