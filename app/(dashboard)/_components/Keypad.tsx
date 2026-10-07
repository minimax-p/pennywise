'use client';

import React, {useEffect} from 'react';
import {Delete} from "lucide-react";
import {cn} from "@/lib/utils";

// Amounts are typed as cents, like a bank app: 8 6 4 0 is $86.40, so there's never a decimal
// point to find. The page draws its own keys, so the phone's keyboard doesn't cover the form.

const MAX_DIGITS = 9;

export function centsToAmount(digits: string) {
    return Number(digits || "0") / 100;
}

export function amountToCents(amount: number) {
    return amount > 0 ? String(Math.round(amount * 100)) : "";
}

export function pressKey(digits: string, key: string) {
    if (key === "back") return digits.slice(0, -1);
    const next = (digits + key).replace(/^0+/, "");
    return next.length > MAX_DIGITS ? digits : next;
}

// Typing digits and Backspace on a computer keyboard works too, unless a text field has focus
export function useKeyboardDigits(active: boolean, onKey: (key: string) => void) {
    useEffect(() => {
        if (!active) return;
        const listener = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (/^\d$/.test(event.key)) onKey(event.key);
            else if (event.key === "Backspace") onKey("back");
            else return;
            event.preventDefault();
        };
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, [active, onKey]);
}

export function Keypad({onKey, className}: { onKey: (key: string) => void, className?: string }) {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"];
    return (
        <div className={cn("grid grid-cols-3 gap-2", className)} aria-label="Number pad">
            {keys.map((key) => (
                <button key={key} type="button" onClick={() => onKey(key)}
                        aria-label={key === "back" ? "Delete last digit" : key}
                        className="grid h-12 place-items-center rounded-2xl bg-secondary font-display text-2xl font-semibold transition-colors active:bg-accent">
                    {key === "back" ? <Delete className="h-6 w-6"/> : key}
                </button>
            ))}
        </div>
    );
}
