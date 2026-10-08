"use client";

import React, {useState} from 'react';
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useQuery} from "@tanstack/react-query";
import {useTheme} from "next-themes";
import {
    ChartPie, Ellipsis, FileUp, House, Inbox, Landmark, List, LockKeyhole, LucideIcon, Monitor, Moon, Plus, Settings, Sun, Users
} from "lucide-react";
import Logo from "@/components/Logo";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Logout} from "@/app/(auth)/login/actions";
import TransactionSheet from "@/app/(dashboard)/_components/TransactionSheet";
import {cn} from "@/lib/utils";

type NavItem = { label: string, link: string, icon: LucideIcon };

const DESKTOP_ITEMS: NavItem[] = [
    {label: "Home", link: "/", icon: House},
    {label: "Transactions", link: "/transactions", icon: List},
    {label: "Sort", link: "/review", icon: Inbox},
    {label: "People", link: "/people", icon: Users},
    {label: "Reports", link: "/reports", icon: ChartPie},
    {label: "Import", link: "/import", icon: FileUp},
    {label: "Manage", link: "/manage", icon: Settings},
];

const MORE_ITEMS: (NavItem & { hint: string })[] = [
    {label: "Accounts", link: "/accounts", icon: Landmark, hint: "Balances and checks"},
    {label: "People", link: "/people", icon: Users, hint: "Who owes you, Zelle and Venmo"},
    {label: "Reports", link: "/reports", icon: ChartPie, hint: "Months and years"},
    {label: "Import", link: "/import", icon: FileUp, hint: "Bank statements"},
    {label: "Manage", link: "/manage", icon: Settings, hint: "Accounts, categories, shortcut"},
];

// Transactions waiting on the Sort page
export function useReviewCount() {
    const {data} = useQuery<{ count: number }>({
        queryKey: ['review', 'count'],
        queryFn: () => fetch('/api/review/count').then((res) => res.json()),
    });
    return data?.count ?? 0;
}

function isActive(pathname: string, link: string) {
    return link === "/" ? pathname === "/" : pathname === link || pathname.startsWith(`${link}/`);
}

function CountBadge({count, className}: { count: number, className?: string }) {
    if (count <= 0) return null;
    return (
        <span className={cn("rounded-full bg-sun px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-[hsl(36_85%_20%)]", className)}>
            {count > 99 ? "99+" : count}
        </span>
    );
}

// The + buttons open the Log sheet, ready for an amount; Spent, Got and Moved are tabs in it
export function AddMenu({open, onOpenChange}: { open: boolean, onOpenChange: (open: boolean) => void }) {
    return <TransactionSheet open={open} onOpenChange={onOpenChange} kind="expense"/>;
}

function ThemeChooser() {
    const {theme, setTheme} = useTheme();
    const options = [
        {value: "light", label: "Light", icon: Sun},
        {value: "dark", label: "Dark", icon: Moon},
        {value: "system", label: "Auto", icon: Monitor},
    ];
    return (
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-secondary p-1.5" role="radiogroup" aria-label="Theme">
            {options.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} onClick={() => setTheme(o.value)}
                        className={cn("flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-bold",
                            theme === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                    <o.icon className="h-4 w-4"/>{o.label}
                </button>
            ))}
        </div>
    );
}

function LockButton({className, label}: { className?: string, label?: boolean }) {
    return (
        <form action={Logout}>
            <Button variant={label ? "outline" : "ghost"} size={label ? "default" : "icon"} type="submit"
                    aria-label="Lock Pennywise" title="Lock" className={className}>
                <LockKeyhole/>{label && "Lock Pennywise"}
            </Button>
        </form>
    );
}

function MoreSheet({open, onOpenChange}: { open: boolean, onOpenChange: (open: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>More</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                    {MORE_ITEMS.map((item) => (
                        <Link key={item.link} href={item.link} onClick={() => onOpenChange(false)}
                              className="flex flex-col gap-2 rounded-3xl border-2 bg-card p-4 shadow-[0_4px_0_0_hsl(var(--border))] active:translate-y-[3px] active:shadow-[0_1px_0_0_hsl(var(--border))]">
                            <item.icon className="h-6 w-6 text-primary"/>
                            <span className="font-display text-base font-semibold leading-tight">{item.label}</span>
                            <span className="text-xs text-muted-foreground">{item.hint}</span>
                        </Link>
                    ))}
                </div>
                <ThemeChooser/>
                <LockButton label/>
            </DialogContent>
        </Dialog>
    );
}

function DesktopNavbar({onAdd}: { onAdd: () => void }) {
    const pathname = usePathname();
    const reviewCount = useReviewCount();
    return (
        <header className="sticky top-0 z-40 hidden border-b-2 bg-background/90 backdrop-blur md:block">
            <nav className="container flex h-[72px] items-center justify-between gap-4">
                <div className="flex items-center gap-6">
                    <Logo/>
                    <div className="flex items-center gap-1">
                        {DESKTOP_ITEMS.map((item) => (
                            <Link key={item.link} href={item.link}
                                  className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold transition-colors",
                                      isActive(pathname, item.link)
                                          ? "bg-primary-soft text-foreground"
                                          : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                                {item.label}
                                {item.link === "/review" && <CountBadge count={reviewCount}/>}
                            </Link>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={onAdd}><Plus/>Add</Button>
                    <ThemeIconButton/>
                    <LockButton/>
                </div>
            </nav>
        </header>
    );
}

function ThemeIconButton() {
    const {resolvedTheme, setTheme} = useTheme();
    return (
        <Button variant="ghost" size="icon" aria-label="Switch light or dark" title="Switch light or dark"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            <Sun className="dark:hidden"/>
            <Moon className="hidden dark:block"/>
        </Button>
    );
}

function MobileTopBar() {
    return (
        <header className="pt-safe sticky top-0 z-40 bg-background/90 backdrop-blur md:hidden">
            <div className="container flex h-14 items-center justify-between">
                <Logo compact/>
                <ThemeIconButton/>
            </div>
        </header>
    );
}

function MobileTabBar({onAdd, onMore}: { onAdd: () => void, onMore: () => void }) {
    const pathname = usePathname();
    const reviewCount = useReviewCount();
    const tab = (active: boolean) => cn(
        "relative flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] font-bold",
        active ? "text-primary" : "text-muted-foreground",
    );
    const moreActive = MORE_ITEMS.some((i) => isActive(pathname, i.link));
    return (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t-2 bg-card/95 backdrop-blur md:hidden" aria-label="Main">
            <div className="mx-auto flex h-16 max-w-md items-start px-2">
                <Link href="/" className={tab(isActive(pathname, "/"))}>
                    <House className="h-6 w-6"/>Home
                </Link>
                <Link href="/transactions" className={tab(isActive(pathname, "/transactions"))}>
                    <List className="h-6 w-6"/>Transactions
                </Link>
                <div className="flex flex-1 justify-center">
                    <button type="button" onClick={onAdd} aria-label="Add a transaction"
                            className="-mt-5 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_5px_0_0_hsl(var(--primary-lip))] transition-transform active:translate-y-[3px] active:shadow-[0_2px_0_0_hsl(var(--primary-lip))]">
                        <Plus className="h-7 w-7" strokeWidth={3}/>
                    </button>
                </div>
                <Link href="/review" className={tab(isActive(pathname, "/review"))}>
                    <span className="relative">
                        <Inbox className="h-6 w-6"/>
                        <CountBadge count={reviewCount} className="absolute -right-3 -top-1.5"/>
                    </span>
                    Sort
                </Link>
                <button type="button" onClick={onMore} className={tab(moreActive)}>
                    <Ellipsis className="h-6 w-6"/>More
                </button>
            </div>
        </nav>
    );
}

function Navbar() {
    const [adding, setAdding] = useState(false);
    const [more, setMore] = useState(false);
    return (
        <>
            <DesktopNavbar onAdd={() => setAdding(true)}/>
            <MobileTopBar/>
            <MobileTabBar onAdd={() => setAdding(true)} onMore={() => setMore(true)}/>
            <AddMenu open={adding} onOpenChange={setAdding}/>
            <MoreSheet open={more} onOpenChange={setMore}/>
        </>
    );
}

export default Navbar;
