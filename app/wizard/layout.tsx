import React, {ReactNode} from 'react';

function layout( {children}:{children: ReactNode} ) {
    return (
        <div className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-background">
            {children}
        </div>
    );
}

export default layout;