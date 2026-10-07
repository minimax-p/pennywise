import React, {ReactNode} from 'react';
import Navbar from "@/components/Navbar";

function Layout({children}: { children: ReactNode }) {
    return (
        <div className="relative flex min-h-dvh w-full flex-col">
            <Navbar/>
            <main className="pb-tabbar w-full md:pb-16">{children}</main>
        </div>
    );
}

export default Layout;
