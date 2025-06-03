"use client";

import React from "react";
import Image from "next/image";
import pennywiseLogo from "./logo/Frame.png";
// import pennywiseLogo from "./logo/all-gold.png";
function Logo() {
    return (
        <a href="/" className="flex items-center gap-2">
            <Image
                src={pennywiseLogo}
                alt="Pennywise Logo"
                className="h-11 w-11 object-contain"
                width={80} // Set width for image optimization
                height={80} // Set height for image optimization
            />
            <p className="text-3xl font-mono font-bold leading-tight tracking-tighter text-primary">
                Pennywise
            </p>
        </a>
    );
}

export function LogoMobile() {
    return (
        <a href="/" className="flex items-center gap-2">
            <p className="text-3xl font-mono font-bold leading-tight tracking-tighter text-primary">
                Pennywise
            </p>
        </a>
    );
}

export default Logo;
