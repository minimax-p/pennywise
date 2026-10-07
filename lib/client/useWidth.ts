'use client';

import {useEffect, useRef, useState} from "react";

// The element's width in pixels, so charts draw at real size and labels stay readable
export function useWidth<T extends HTMLElement>(fallback: number) {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(fallback);
    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}
