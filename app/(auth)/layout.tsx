import React, {ReactNode} from "react";

function layout({children}: { children: ReactNode }) {
    return (
        <div className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-background px-4">
            {children}
            <p className="mt-6 font-display text-lg font-bold text-muted-foreground">Pennywise</p>
        </div>
    );
}

export default layout;
