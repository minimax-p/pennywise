import React, {ReactNode} from 'react';
import Navbar from "@/components/Navbar";

function Layout({children}: {children: ReactNode}) {
    // @ts-ignore
    return (

        <div className="relative flex h-screen w-full flex-col">
            <Navbar />
            <div className="w-full ">{children}</div>
        </div>
    );
}

export default Layout;